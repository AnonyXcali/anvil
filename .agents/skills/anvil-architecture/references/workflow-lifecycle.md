# Workflow lifecycle

The frontend engineering workflow is created in `src/mastra/index.ts` and registered as `anvil-agent-create-workflow`. It runs search, planning, input compression, and editing steps.

The search step now has an internal two-phase boundary while still returning the same workflow handoff contract. First, the tool-capable search agent performs history-aware repository search. Second, a tool-free finalizer agent converts the validated search evidence into the compact structural plan. The supervisor-side search step then normalizes that result back into the legacy search payload expected by the planning, compression, and editing steps, so downstream workflow stages do not need a new contract.

The plan step calls `context.suspend(...)` with an approval payload. Mastra provides the workflow run ID and persists its snapshot through the PostgreSQL-backed `workflows` storage domain in the `mastra` schema. Agent memory is persisted through the PostgreSQL-backed `memory` domain in the same schema. The supervisor service observes workflow stream events and upserts the application workflow record with workflow ID, run ID, project, conversation, status, suspended step, and (for supervisor-owned approvals) the agent/tool resume target.

`CoreService` validates the approval request, atomically claims the suspended application row, and resumes the persisted `anvil-supervisor-agent` run with `{ approved }` when a resume target is present. Legacy rows without a target use the direct workflow compatibility path. Resume stream chunks are relayed to the same channel contract. A successful run completes after the editing workflow returns; a denied plan bails with a no-change response.

The staged edit workflow prepares every affected file locally before commit. Its per-file workflow branches on the authoritative `operation`: new files are written locally during preparation and bypass download and existing-file edit strategies, while edits and deletes retain their existing instruction paths. New files are verified and project-validated alongside existing files, then created and uploaded remotely only during commit. The application workflow record is separate from Mastra storage and exists to support user-facing approval and status lookup. A row marked `suspended` is not sufficient to resume a run if the corresponding Mastra snapshot is missing; the resume path logs that mismatch and fails the application run safely.

Repairable verifier/scorer and deterministic CSS findings create an application
repair transaction and preserve the staging workspace and manifest. Passed
files may commit while affected files remain local. The existing `edit_status`
contract reports `completed_with_issues`; one repair approval then starts a
separate bounded supervisor run over the `workflow-resume` stream. Successful
repair resolves bugs by stable ID before final cleanup.

See [`anvil-edit-workflow-flowchart.svg`](./anvil-edit-workflow-flowchart.svg) for the visual happy path, including the new-file and existing-file branches.
## Phase milestones and transcript persistence

Approved `structure_plan.phases` are represented in the staged manifest as
milestones. Each milestone owns its files, derived cross-phase dependencies,
validation status, and commit status. The staged workflow executes milestones
sequentially with Mastra `foreach(..., { concurrency: 1 })`; each iteration
prepares its files locally, applies and verifies them, runs milestone-local
validation, re-checks remote state, and commits only that milestone. A strict
failure in a later milestone preserves its manifest entries, backups, hashes,
and staged files without rolling back earlier committed milestones.

Repairable verifier/CSS findings keep the affected milestone local while
independent passed milestones remain eligible for commit; dependent milestones
remain blocked. The manifest is the restart-safe local detail record, while the
edit transaction/milestone/bug tables hold the authoritative lifecycle state.

Redis continues to store every stream chunk. PostgreSQL conversation messages
contain only completed, user-visible transcript content. Stream publishers do
not write message rows per chunk; orchestrators aggregate visible text and use
an idempotent `(conversation_id, source_id)` assistant-message write.
