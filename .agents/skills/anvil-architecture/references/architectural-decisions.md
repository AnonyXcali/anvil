# Architectural decisions

These decisions describe the current implementation and should be revised when the architecture changes materially.

## ADR-001: Centralize Mastra registration

**Decision:** Register runtime agents and workflows in `src/mastra/index.ts`.

**Reason:** A single registry makes runtime exposure and dependency construction discoverable.

**Consequence:** Agent factories receive their infrastructure/workflow dependencies from the registry. Tools may be exposed transitively through registered agent factories.

## ADR-002: Use workflows for multi-stage agentic orchestration

**Decision:** The supervisor delegates frontend work to a durable workflow with search, plan, approval, compression, and edit stages.

**Reason:** Workflow steps provide explicit sequencing, suspension, resume, and state boundaries.

**Consequence:** The supervisor agent remains a routing/decision boundary, while workflow lifecycle is persisted and relayed by application services.

## ADR-003: Keep infrastructure behind services

**Decision:** Database, Redis, channels, SSH, filesystem, Docker, and port operations remain behind feature or infrastructure services.

**Reason:** Orchestration should not embed external-system implementation details.

**Consequence:** Workflows and agents depend on service capabilities rather than shell, SFTP, or database implementation.

## ADR-004: Persist workflow approval state in the application database

**Decision:** Store workflow ID, run ID, project, conversation, status, and suspended step in `preview_platform.workflow_run` in addition to Mastra snapshots.

**Reason:** The API and UI need an application-owned approval request and resume lookup.

**Consequence:** Supervisor and core services coordinate Mastra storage with application persistence.

## ADR-005: Use BullMQ for asynchronous processing

**Decision:** Long-running intent, conversation, agent, project, and code-generation work runs through BullMQ processors.

**Reason:** Requests can return job identifiers while workers handle long-running work and status updates.

**Consequence:** Application job records and BullMQ lifecycle events must remain aligned.

## ADR-006: Use Docker Compose for the local dependency stack

**Decision:** Local Docker scripts run API, Postgres, and Redis together, with `up.sh` handling migrations and DB type generation.

**Reason:** The application requires coordinated infrastructure for realistic local execution.

**Consequence:** `restart.sh` is a destructive database reset because it removes the Compose volume; host-based `pnpm start:dev` remains available when dependencies are provided externally.

## ADR-007: Use discoverable filesystem skills for reusable search guidance

**Decision:** Keep reusable search and architecture playbooks in root-level `mastra-skills/` directories and attach the relevant filesystem skill roots to the Anvil search agent. Keep non-negotiable contracts in prompts, schemas, and services.

**Reason:** Search sequencing, project-structure conventions, CSS/TSX analysis, and edit-planning guidance are reusable knowledge that should not continually expand the active system prompt.

**Consequence:** Skills must be copied into the production image and fail clearly when unavailable. Skills do not replace runtime validation or application-owned behavior. The explicit `greedy` diagnostic mode disables skills to isolate one-call search behavior; normal production search is multi-search.

## ADR-008: Split repository search from structural finalization while preserving the legacy search handoff

**Decision:** Run Anvil search as two logical phases with the same configured search model: a tool-capable search phase that performs history-aware repository search, followed by a tool-free finalizer phase that returns only the compact structural plan. Normalize the finalizer output back into the legacy internal search handoff before downstream workflow steps consume it.

**Reason:** Combining repository-search tools, strict final structured output, and error shapes in one model phase creates an oversized grammar surface for some providers. Separating the tool call from the final strict schema reduces that pressure without forcing new downstream workflow contracts.

**Consequence:** Search validation stays authoritative in application code, the finalizer cannot invoke repository tools, and approval/compression/editing continue to receive the established normalized search payload. Normal mode collects up to 10 bounded search results, while greedy remains an explicit one-search diagnostic policy. Search behavior is easier to reason about as evidence collection followed by tool-free planning, while legacy consumers remain unchanged.

## ADR-009: Keep the structural edit plan application-owned during execution

**Decision:** Store the approved structural plan in the edit `RequestContext` and inject it into the internal edit workflow. The editing agent submits file instructions and execution metadata only; it does not reproduce or control the structural plan.

**Reason:** Repeating the plan in every model-facing file entry increases input size and allows the model to create inconsistent copies across a multi-file handoff.

**Consequence:** The model-facing edit payload is smaller, staged validation receives one canonical plan, and the editing agent cannot supply a competing structural plan.

## ADR-011: Keep edit runtime state out of the editing-agent contract

**Decision:** The editing agent may return approved file metadata and edit instructions, but it may not return runtime execution fields. `structure_plan`, verification flags, hashes, backup paths, local paths, errors, and commit state are strict backend-owned fields.

**Reason:** Runtime fields are workflow state, not edit intent. Exposing them allows the model to regenerate malformed values such as `verified: null` or `isEdited: null`, creating avoidable tool-validation failures and weakening ownership boundaries.

**Consequence:** Strict model-facing schemas reject runtime fields before workflow creation. The supervisor injects the canonical structural plan and the workflow initializes all runtime state internally.

## ADR-010: Route new files through the staged create branch

**Decision:** Treat `operation: create` as a distinct staged-file workflow branch. The staging preparation step writes the complete new file locally; the create branch confirms that local state and skips download, range edits, patches, and replacements. Remote directories and the remote file are created only during the commit phase, followed by complete-file upload.

**Reason:** A new file has no remote source to download and no existing line range to edit. Sending it through the existing-file path causes the `0 → 0` create range to reach the range editor and fail.

**Consequence:** Single-file create requests are routed to the staged workflow, new-file verification remains consistent with other staged files, and remote mutation stays deferred until all validation gates pass.
