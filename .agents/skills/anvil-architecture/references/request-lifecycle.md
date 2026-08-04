# Request lifecycle

1. An authenticated controller receives a conversation or project request.
2. `CoreService` persists or retrieves the conversation context and enqueues intent work.
3. `IntentProcessor` asks the registered `anvil-intent-agent` to classify the request using ordered application-database history and the latest query. The agent uses non-streaming structured output; the classifier result is internal and is not published to Redis/SSE.
4. `instant` work is sent to the conversation processor with conversation history and `projectId`; `offload` work is queued for the supervisor processor.
5. The conversation processor starts `anvil-convo` and relays only non-empty text deltas through `ChannelsService`. The supervisor service starts the supervisor agent stream and relays its workflow events.
6. The supervisor workflow searches the project, creates a plan, and suspends for human approval when changes are proposed.
7. Approval state is persisted in `preview_platform.workflow_run`; the user decision reaches `CoreService`, which resumes the workflow run.
8. The editing agent prepares missing project files and invokes the edit workflow. The workflow downloads, backs up, edits, verifies, uploads, and cleans up.
9. Final messages and job state are persisted while stream events remain available through Redis-backed SSE.

Queue and stream processing are asynchronous. HTTP callers generally receive identifiers or an acknowledgement and observe progress through status queries or SSE.
