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
- `DATABASE_URL`: application database connection string.
- `MASTRA_DATABASE_URL`: Mastra storage connection string for agent memory and workflow snapshots.
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

`src/core/` receives user messages, stores the conversation context, and routes each request to one of two paths. Short conversational requests are handled by the conversation agent and streamed back as text. Project-change requests are handled asynchronously by the supervisor flow. BullMQ and Redis carry background work and live stream updates, while Postgres stores application and workflow state.

### Request flows

```text
User message
    |
    v
Intent routing
    |------------------------------|
    v                              v
Instant conversation          Project change
    |                              |
Text streamed over SSE       Search → structural plan → approval
                                   |
                         staged edit → verify → preview update
```

The conversation agent can answer about Anvil, inspect the current project, look up relevant public information, and inspect the rendered preview when needed. Its user-facing stream contains the assistant response rather than internal reasoning or tool details.

The project-change path runs through a Supervisor Agent. A search phase reads project context and performs bounded repository searches; a separate tool-free planning phase turns that evidence into structural metadata and dependency ordering. The workflow then prepares a business-facing approval summary, pauses for human approval, and delegates the approved work to editing and verification stages. Technical file plans remain internal to the workflow.

Approved changes are handled through a staged edit transaction. Existing files are downloaded to a job-scoped backend workspace and can use line-range edits, unified patches, or complete-file replacement. New files are created locally during staging and bypass the existing-file download/edit path. Files are validated before remote commit; related multi-file changes are committed in deterministic order with backups and best-effort rollback on failure.

Preview work is executed on a configured SSH host. The backend manages project-specific remote workspaces, builds Docker previews, controls project containers, and performs project-scoped file operations through SSH/SFTP.

## Agentic Capabilities

- Authenticated conversations: runs session-aware chat flows through `/core`.
- Intent routing: classifies requests as instant responses or offloaded project work.
- Streaming responses: publishes request-scoped conversation text and agent progress over Redis-backed SSE channels.
- Stream-aware testing UI: displays composed assistant replies, live progress, approval requests, completion state, and raw event data.
- Project workspaces: creates isolated project records and remote workspace folders for generated previews.
- React preview generation: creates and updates Vite React preview projects.
- Supervisor workflow: coordinates search, planning, approval, editing, verification, and preview updates.
- Structural planning: records file ownership, architectural roles, dependencies, directory creation, preservation constraints, and deterministic execution order.
- Discoverable search guidance: loads bundled `mastra-skills/` playbooks for repository search, project structure, architecture history, CSS/TSX analysis, and edit planning. Runtime schemas and backend validation remain authoritative.
- Human-in-the-loop approval: pauses before applying proposed changes and resumes after accept or deny.
- Safe staged project editing: applies line-range edits, unified patches, complete-file replacement, and new-file creation locally before verification and remote commit.
- Cross-file validation: checks staged imports, route targets, CSS syntax, stylesheet selectors, and supported project build/type checks before upload.
- Durable Mastra state: stores agent memory and suspended workflow snapshots in PostgreSQL, while Redis carries queues and stream chunks.
- Application-owned runtime state: editing agents return file instructions only; the backend owns hashes, backups, verification state, staging manifests, uploads, rollback, and cleanup.
- Context-aware conversation tools: support project search, public web research, page content lookup, and preview inspection.
- SSH project tools: support project-scoped file download, upload, backup, delete, create, verify, and bounded reads.
- Streaming helpers: normalize workflow, approval, status, error, and response events for the testing UI.
- Preview lifecycle control: starts, stops, tracks, and updates project preview containers.

## Future plans

- Evolve the workflow toward smaller milestones and HITL-gated repair loops, using a project `architecture/BUGS.md` to track unresolved issues between supervisor runs.
- Reduce token usage across search, planning, edit, and verification loops.
- Add the ability to switch models per agent or workflow stage.
- Bring live preview access directly into the application.
- Improve preview isolation, authenticated preview URLs, and production-safe routing.
- Explore a Mac application for a more polished user-side experience.
