# Request lifecycle

1. An authenticated controller receives a conversation or project request.
2. `CoreService` persists or retrieves the conversation context and enqueues intent work.
3. `IntentProcessor` asks the registered `anvil-intent-agent` to classify the request using ordered application-database history and the latest query. The agent uses non-streaming structured output; the classifier result is internal and is not published to Redis/SSE.
4. `instant` work is sent to the conversation processor with conversation history and `projectId`; `offload` work is queued for the supervisor processor.
5. The conversation processor starts `anvil-convo` and relays only non-empty text deltas through `ChannelsService`. The supervisor service starts the supervisor agent stream and relays its workflow events.
6. The supervisor workflow searches the project in two phases: the search agent reads history once and executes one or more bounded validated repository searches, then a tool-free finalizer turns the collected evidence into the structural edit plan. Application code normalizes that finalizer output into the legacy internal search result shape, then the workflow creates a plan and suspends for human approval when changes are proposed. Normal mode permits up to 10 searches; greedy diagnostic mode permits one.
7. Approval state is persisted in `preview_platform.workflow_run`; the user decision reaches `CoreService`, which resumes the workflow run.
8. The editing agent prepares missing project files and invokes the edit workflow. The workflow downloads, backs up, edits, verifies, uploads, and cleans up.
9. Final messages and job state are persisted while stream events remain available through Redis-backed SSE.

Project initialization follows the same intent path after scaffolding: the creation request stores the project description and first user message, the scaffold worker infers a display name, builds the preview, and enqueues intent classification for that existing conversation. Preview navigation uses the persisted project URL rather than a transcript message.

Queue and stream processing are asynchronous. HTTP callers generally receive identifiers or an acknowledgement and observe progress through status queries or SSE.
