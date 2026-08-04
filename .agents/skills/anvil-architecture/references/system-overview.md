# System overview

Anvil is a NestJS backend for authenticated conversations, agentic project work, and React preview sandboxes. The main runtime components are:

- NestJS controllers and services for HTTP APIs and business orchestration.
- Better Auth for authentication and session handling.
- BullMQ and Redis for asynchronous work and stream transport.
- Postgres, accessed through Kysely and database services, for application state.
- Mastra agents and workflows for conversation, search, planning, editing, verification, and approvals.
- SSH/SFTP-backed remote workspaces and Docker preview containers.

## Dependency direction

HTTP/controllers and queue processors call application services. Application services coordinate database, queue, channel, Mastra, port, and SSH services. Mastra agents and workflows call tools and domain services, while infrastructure operations remain behind services such as `SshService`, `ChannelsService`, and the database modules.

## User request flow

The intent processor classifies work. Instant conversation work uses the conversation queue and `anvil-convo`, which streams plain text deltas and can use project search, Exa, Firecrawl, and Lightpanda preview inspection. Agentic project work is queued for the supervisor, which streams the supervisor agent and its frontend engineering workflow. That workflow searches files, creates a human-readable plan, suspends for approval, and then delegates editing and verification.

## Local runtime modes

`pnpm start:dev` runs Nest directly and requires external Postgres, Redis, environment, and SSH configuration. `infrastructure/local/up.sh` starts Postgres and Redis, migrates the database, regenerates DB types, rebuilds the API image, and runs Docker Compose in the foreground. `docker compose up -d --build` runs the full stack in the background. The API is normally at `http://localhost:3000`; the testing UI is at `/testing` and `/testing/auth`.

The API container is built from `Dockerfile` and runs `node dist/main.js`. Compose publishes API port 3000, Redis port 6379, and Postgres port 5432.

Known gaps include development-only testing UI behavior, direct preview URL construction, and security TODOs documented in the Compose file and security reference.
