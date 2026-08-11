# System overview

Anvil is a NestJS backend for authenticated conversations, agentic project work, and React preview sandboxes. The main runtime components are:

- NestJS controllers and services for HTTP APIs and business orchestration.
- Better Auth for authentication and session handling.
- BullMQ and Redis for asynchronous work and stream transport.
- Postgres, accessed through Kysely and database services, for application state plus Mastra workflow snapshots in the dedicated `mastra` schema.
- Mastra agents and workflows for conversation, search, planning, editing, verification, and approvals.
- Backend-bundled Mastra filesystem skills under `mastra-skills/` for discoverable search and architecture guidance.
- SSH/SFTP-backed remote workspaces and Docker preview containers.

## Dependency direction

HTTP/controllers and queue processors call application services. Application services coordinate database, queue, channel, Mastra, port, and SSH services. Mastra agents and workflows call tools and domain services, while infrastructure operations remain behind services such as `SshService`, `ChannelsService`, and the database modules.

## User request flow

The intent processor classifies work. Instant conversation work uses the conversation queue and `anvil-convo`, which streams plain text deltas and can use project search, Exa, Firecrawl, and Lightpanda preview inspection. Agentic project work is queued for the supervisor, which streams the supervisor agent and its frontend engineering workflow. That workflow now separates repository search from structural planning: the search agent performs the history-aware repository lookup, a tool-free finalizer converts the search evidence into the structural edit plan, and application code normalizes that result into the legacy handoff consumed by planning, approval, compression, editing, and verification.

## Local runtime modes

`pnpm start:dev` runs Nest directly and requires external Postgres, Redis, environment, and SSH configuration. `infrastructure/local/up.sh` starts Postgres and Redis, migrates the database, regenerates DB types, rebuilds the API image, and runs Docker Compose in the foreground. `docker compose up -d --build` runs the full stack in the background. The API is normally at `http://localhost:3000`; the testing UI is at `/testing` and `/testing/auth`.

The API container is built from `Dockerfile` and runs `node dist/main.js`. Compose publishes API port 3000, Redis port 6379, and Postgres port 5432. Mastra workflow snapshots are stored in Postgres so API container recreation does not remove suspended workflow state; LibSQL remains local for agent memory.

## Runtime skills

The search agent can load concise filesystem skills from root-level `mastra-skills/`. The Docker image copies this directory to `/app/mastra-skills`, and the agent resolves skill roots from the process working directory. Current playbooks cover search-tool usage, frontend project structure, architecture history, CSS/TSX analysis, and structural edit planning. Skills are guidance only; Zod schemas, service preflight validation, sensitive-file restrictions, and workflow contracts remain authoritative. Normal production search collects up to 10 bounded search results; the explicit `greedy` diagnostic mode disables skill loading and limits repository search to one call.

Known gaps include development-only testing UI behavior, direct preview URL construction, and security TODOs documented in the Compose file and security reference.
