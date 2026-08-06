# Workflow lifecycle

The frontend engineering workflow is created in `src/mastra/index.ts` and registered as `anvil-agent-create-workflow`. It runs search, planning, input compression, and editing steps.

The plan step calls `context.suspend(...)` with an approval payload. Mastra provides the workflow run ID; the supervisor service observes workflow stream events, loads snapshots from Mastra storage when needed, and upserts the application workflow record with workflow ID, run ID, project, conversation, status, and suspended step.

`CoreService` validates the approval request, obtains the stored workflow identifiers, creates a workflow run using the persisted run ID, and resumes it with `{ approved }`. Resume stream chunks are relayed to the same channel contract. A successful run completes after the editing workflow returns; a denied plan bails with a no-change response.

The nested edit workflow uses `foreach` for file edits and instructions, persists workflow state, and invokes the verification agent for each instruction. The application workflow record is separate from Mastra storage and exists to support user-facing approval and status lookup.
