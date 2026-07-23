![Anvil banner](docs/assets/anvil-banner.png)

# ANVIL

## Description

Anvil(earlier known as Ship Forge) is a NestJS backend for authenticated AI conversations, agentic project work, and React preview sandboxes.

It uses Better Auth, OpenAI, BullMQ, Redis, Postgres, Mastra agents, and SSH-backed Docker previews.

Developer log: [anvil-agent-log-website.vercel.app](https://anvil-agent-log-website.vercel.app/)

## Get started

Install dependencies:

```bash
pnpm install
```

Create a local `.env` from `.env.example` and provide the required runtime values:

- `PORT`: API port, defaults to `3000`.
- `OPENAI_API_KEY` and `OPENAI_MODEL`: model access for conversation and agent flows.
- `VAST_BASE_URL`, `VAST_AUTH_URL`, and `VAST_MODEL`: optional VAST-compatible model endpoint settings.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`: Postgres settings used by the local stack.
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`: auth/session configuration.
- `SSH_HOST`, `SSH_PORT`, `SSH_USERNAME`, and `SSH_PRIVATE_KEY_PATH`: remote preview workspace access.
- `MASTRA_PLATFORM_ACCESS_TOKEN` and `MASTRA_PROJECT_ID`: Mastra platform configuration when using platform-backed features.
- `ENABLE_TESTING_UI`: enables the internal testing UI when configured.
- `NODE_ENV`: runtime environment, usually `development` locally.

When running outside Docker, also provide `DATABASE_URL`, `REDIS_HOST`, and `REDIS_PORT` for the application runtime.

Run database migrations and regenerate DB types after schema changes:

```bash
pnpm db:migrate
pnpm db:codegen
```

Run locally:

```bash
pnpm start:dev
```

Or run the local stack with Docker:

```bash
docker compose up -d --build
```

The API runs on `http://localhost:3000` by default. The internal testing UI is hosted at:

```text
http://localhost:3000/testing
```

The sign-in/sign-up screen is available at:

```text
http://localhost:3000/testing/auth
```

## Architecture Description

The main user flow starts with a project workspace. A project owns its conversation, generated files, active preview port, container state, and job history.

`src/core/` receives user messages, classifies intent, and routes work to either normal conversation handling or the agentic offload path. Long-running work runs through BullMQ queues. Redis powers queueing and Server-Sent Events, while Postgres stores users, projects, conversations, messages, jobs, generated files, and workflow run state.

The main offload path now runs through a Supervisor Agent. The supervisor owns a frontend engineering workflow that searches the project, prepares a user-facing plan, waits for human approval, and then delegates precise file changes to an editing workflow.

Preview work is executed on a configured SSH host. The backend manages project-specific remote workspaces, builds Docker previews, controls project containers, and performs project-scoped file operations through SSH/SFTP.

## Agentic Capabilities

- Authenticated conversations: runs session-aware chat flows through `/core`.
- Intent routing: classifies requests as instant responses or offloaded project work.
- Streaming responses: publishes model and agent output over Redis-backed SSE channels.
- Project workspaces: creates isolated project records and remote workspace folders for generated previews.
- React preview generation: creates and updates Vite React preview projects.
- Supervisor workflow: coordinates search, planning, approval, editing, verification, and upload.
- Human-in-the-loop approval: pauses before applying proposed changes and resumes after accept or deny.
- Precise editing workflow: downloads target files locally, creates remote backups, applies line-range edits, verifies changes, and replaces remote files after hash checks.
- SSH project tools: support project-scoped file download, upload, backup, delete, create, verify, and bounded reads.
- Streaming helpers: normalize workflow, tool, approval, debug, and status events for the testing UI.
- Preview lifecycle control: starts, stops, tracks, and updates project preview containers.

## Future plans

- Reduce token usage across search, planning, edit, and verification loops.
- Add the ability to switch models per agent or workflow stage.
- Bring live preview access directly into the application.
- Improve preview isolation, authenticated preview URLs, and production-safe routing.
- Explore a Mac application for a more polished user-side experience.
