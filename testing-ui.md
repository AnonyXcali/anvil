# Testing UI

A NestJS + Handlebars rendered UI, for testing purposes.

# Goal

The UI shall provide immediate testing to

- Create a user account.
- Login into a created user account.
- Create a Project.
- Start a conversation
- Chat interface to test intent flow.
- Chat interface to view received chunks from Redis.
- Chat interface to interact with system.
- Test HITL flows
- Status of project scaffolding/modification/ready state.
- View Projects
- Rename Projects
- Delete Projects
- Stop Preview Containers.

NOTE: use composition architecture to plan. The UI has to be plain and simple, this is meant for quick testing and not for extensively planned and designed UI for external users.

# UI primitives

Button
TextField
Textarea
Card
Badge
Spinner
Divider
ScrollArea
Panel
Tabs
Modal
CodeBlock
Markdown
CopyButton

# features

- Authentication test console
  - Sign up with name, email, and password using `POST /auth/sign-up`.
  - Sign in with email and password using `POST /auth/sign-in`.
  - Show current cookie/session state and provide a clear unauthenticated/authenticated state.
  - List existing users for quick local verification using `GET /user`.

- Project test console
  - Create a project with a name using `POST /project`.
  - List projects using `GET /project`.
  - Open a project detail view using `GET /project/:projectId`.
  - Rename a project using `PATCH /project/:projectId`.
  - Delete a stopped or errored project using `DELETE /project/:projectId`.
  - Start and stop preview containers using `POST /project/start` and `POST /project/stop`.
  - Poll project jobs with `GET /project/:projectId/job/:jobId`.
  - Display project status values: `processing`, `active`, `stopped`, `errored`.
  - Display active port and preview URL when available.

- Conversation and intent test console
  - Start a new project-scoped conversation using `POST /core`.
  - Continue an existing conversation using `POST /core/talk`.
  - Subscribe to streamed chunks using `GET /core/:conversation_id` as SSE.
  - Show user messages, assistant chunks, job status, and raw event payloads in one place.
  - Keep the active `project_id` and `conversation_id` visible and copyable for debugging.
  - Provide sample prompts for instant conversation flow and offloaded agent flow.

- Redis chunk inspection
  - Render live chunks received through the SSE relay.
  - Provide a raw chunk log tab that preserves sequence, timestamp if present, and JSON payload.
  - Provide a composed assistant output tab that appends text deltas into a readable response.
  - Flag malformed chunks without breaking the active stream.

- HITL test console
  - Detect `approval_required` events from streamed chunks.
  - Render the approval title, message, approval id, and raw payload.
  - Submit accept or deny decisions using `POST /core/decision`.
  - Disable approve/deny buttons immediately after either decision is submitted.
  - Show workflow statuses: `pending`, `running`, `suspended`, `completed`, `failed`, `cancelled`.
  - Continue streaming after a workflow is resumed.

- Operational debugging
  - Show recent job ids returned by flow, project start, and project stop actions.
  - Show request method, path, payload, response body, and error body for each interaction.
  - Provide copy buttons for IDs, JSON payloads, SSE event logs, and preview URLs.
  - Provide a manual SSE test action using `GET /core/test/:conversation_id`.

# Routes

These are UI routes rendered by NestJS controllers. They should be separate from the JSON/API controllers where practical, for example under `/testing`.

- `GET /testing`
  - Dashboard shell.
  - Shows auth state, selected project, selected conversation, and quick links to each testing area.

- `GET /testing/auth`
  - Sign-up and sign-in forms.
  - User list/debug panel.

- `POST /testing/auth/sign-up`
  - HTMX form endpoint.
  - Calls `AuthService.createUser`, forwards `Set-Cookie`, and returns the updated auth panel.

- `POST /testing/auth/sign-in`
  - HTMX form endpoint.
  - Calls `AuthService.signInUser`, forwards `Set-Cookie`, and returns the updated auth panel.

- `GET /testing/projects`
  - Project list page/fragment.
  - Calls `ProjectService.findAll`.

- `POST /testing/projects`
  - Create project form endpoint.
  - Calls `ProjectService.insert` and returns the project list plus active project context.

- `GET /testing/projects/:projectId`
  - Project detail page.
  - Calls `ProjectService.findById`.
  - Shows status, preview metadata, conversations, and available actions.

- `PATCH /testing/projects/:projectId`
  - Rename project form endpoint.
  - Calls `ProjectService.update`.

- `DELETE /testing/projects/:projectId`
  - Delete project action.
  - Calls `ProjectService.delete`.

- `POST /testing/projects/:projectId/start`
  - Start preview container.
  - Calls `ProjectService.start` and returns a job status panel.

- `POST /testing/projects/:projectId/stop`
  - Stop preview container.
  - Calls `ProjectService.stop` and returns a job status panel.

- `GET /testing/projects/:projectId/jobs/:jobId`
  - HTMX polling fragment for project job state.
  - Calls `ProjectService.jobStatus`.

- `GET /testing/projects/:projectId/conversations/new`
  - New conversation form for the selected project.

- `POST /testing/projects/:projectId/conversations`
  - Starts a conversation.
  - Calls `CoreService.handleFlowInitiation` and returns the chat panel with `conversation_id`.

- `GET /testing/projects/:projectId/conversations/:conversationId`
  - Chat test page for a project conversation.
  - Connects the browser to the existing API SSE route: `GET /core/:conversation_id`.

- `POST /testing/projects/:projectId/conversations/:conversationId/messages`
  - Sends a follow-up message.
  - Calls `CoreService.talk`.

- `POST /testing/approvals/:approvalRequestId/decision`
  - HTMX HITL decision endpoint.
  - Calls `CoreService.handleDecision` with `accept` or `deny`.

- `GET /testing/projects/:projectId/conversations/:conversationId/sse-test`
  - Manual SSE smoke-test action.
  - Calls `CoreService.test`.

# Components

- `TestingLayout`
  - Shared shell with navigation tabs for Auth, Projects, Chat, Chunks, HITL, and Raw Debug.

- `AuthPanel`
  - Contains `SignUpForm`, `SignInForm`, `SessionBadge`, and `UserList`.

- `ProjectPanel`
  - Contains `ProjectCreateForm`, `ProjectList`, `ProjectCard`, `ProjectStatusBadge`, and `ProjectActions`.

- `ProjectDetailPanel`
  - Shows project metadata, active port, preview link, last known job, and rename/delete/start/stop controls.

- `JobStatusPanel`
  - Polling fragment for queued, active, completed, and failed jobs.
  - Displays error text when present.

- `ChatPanel`
  - Contains `ConversationStarter`, `MessageComposer`, `MessageList`, and `ConversationMeta`.

- `MessageList`
  - Scrollable transcript with separate rendering for user, assistant, system, and tool messages.

- `SseStreamController`
  - Client-side controller responsible for opening the EventSource connection to `GET /core/:conversation_id`, reconnecting, and forwarding events into UI targets.

- `ChunkInspector`
  - Tabs for composed output, raw events, parsed JSON, and errors.

- `ApprovalRequestCard`
  - Renders HITL approval events.
  - Includes approve/deny buttons, disabled/submitting state, and final decision state.

- `DebugRequestLog`
  - Captures method, path, payload, response, status code, and timestamp for recent UI actions.

- `JsonCodeBlock`
  - Lightweight wrapper around `CodeBlock` and `CopyButton` for request/response payloads.

- `ErrorPanel`
  - Shared rendering for validation errors, failed API calls, failed jobs, and stream disconnects.

- `EmptyState`
  - Plain helper state for no projects, no selected project, no conversation, and no chunks yet.

# Proposed Plan

- Phase 1: Add testing UI module
  - Create a `TestingModule` with a `TestingController` and `TestingService`.
  - Keep this module isolated from production API controllers.
  - Register the module in `src/app.module.ts`.
  - Use server-rendered templates/partials for HTMX responses.

- Phase 2: Add basic layout and primitives
  - Implement the listed primitives as plain template partials/classes: Button, TextField, Textarea, Card, Badge, Spinner, Divider, ScrollArea, Panel, Tabs, Modal, CodeBlock, Markdown, CopyButton.
  - Keep styling minimal and utility-focused.
  - Prefer stable IDs and `data-*` attributes for HTMX targets and SSE event handling.

- Phase 3: Wire authentication flows
  - Build sign-up and sign-in forms.
  - Forward auth cookies from the underlying Better Auth responses.
  - Show current session/auth state after each action.
  - Add request/response debug output for local testing.

- Phase 4: Wire project management
  - Build project creation, listing, detail, rename, delete, start, and stop interactions.
  - Add job polling fragments for scaffold/start/stop jobs.
  - Surface active port and preview URL as soon as they are available.
  - Guard destructive delete action behind a small confirmation modal.

- Phase 5: Wire conversation and intent testing
  - Add project-scoped conversation start form using `CoreService.handleFlowInitiation`.
  - Add follow-up message form using `CoreService.talk`.
  - Keep selected project and conversation context persistent in the page.
  - Display returned job/conversation IDs immediately.

- Phase 6: Wire SSE and Redis chunk inspection
  - Add a small client script that opens `EventSource('/core/:conversation_id')`.
  - Append raw SSE messages to `ChunkInspector`.
  - Parse JSON chunks when possible and append text deltas to the transcript.
  - Show stream connection state and reconnect attempts.

- Phase 7: Wire HITL approvals
  - Detect streamed payloads where `type === 'approval_required'`.
  - Render `ApprovalRequestCard` with accept/deny actions.
  - POST decisions to the testing approval route, which delegates to `CoreService.handleDecision`.
  - Disable buttons immediately after submit and show resumed stream output.

- Phase 8: Add targeted tests
  - Add controller tests for testing routes that verify service delegation and cookie forwarding.
  - Add rendering tests for the key partials if the chosen template layer supports them.
  - Add an e2e smoke test for sign in, project create, conversation start, SSE test message, and project stop.
