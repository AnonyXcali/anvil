# ANVIL

## Description

Anvil(earlier known as Ship Forge) is a NestJS backend for authenticated AI conversations, agentic project work, and React preview sandboxes.

It uses Better Auth, OpenAI, BullMQ, Redis, Postgres, Mastra agents, and SSH-backed Docker previews.

## Architecture Description

The main user flow starts with a project workspace. A project owns its conversation, generated files, active preview port, container state, and job history.

`src/core/` receives user messages, classifies intent, and routes work to either normal conversation handling or the agentic offload path. Long-running work runs through BullMQ queues. Redis powers queueing and Server-Sent Events, while Postgres stores users, projects, conversations, messages, jobs, and generated files.

Preview work is executed on a configured SSH host. The backend writes React files into a project-specific workspace, builds Docker previews, and controls project containers through start and stop jobs.

## Agentic Capabilities

- Authenticated conversations: runs session-aware chat flows through `/core`.
- Intent routing: classifies requests as instant responses or offloaded project work.
- Streaming responses: publishes model and agent output over Redis-backed SSE channels.
- Project workspaces: creates isolated project records and remote workspace folders for generated previews.
- React preview generation: creates and edits `src/App.tsx` for Vite React previews.
- Anvil agent flow: uses a Mastra agent to inspect project context and produce precise change instructions.
- Search tools: lets the Anvil agent search files and content inside the project workspace.
- Preview lifecycle control: starts, stops, tracks, and updates project preview containers.

## Future plans

- Route more `/core` offload requests into full agentic React code generation.
- Expand the Anvil agent from search-and-instruct flows into direct multi-file editing.
- Add stronger preview isolation, authenticated preview URLs, and production-safe routing.
- Improve project job tracking and frontend polling around long-running work.
- Grow specialized tools for planning, editing, testing, building, and deploying generated apps.
