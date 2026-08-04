# Workspace and preview

Projects use a remote SSH host for workspace and preview operations. `SshService` owns command execution, project-relative path validation, SFTP transfers, local temporary files, backups, Docker build/serve operations, file operations, and search commands. Project IDs scope remote workspace paths and container names.

`ProjectService` owns application-level preview metadata lookup. Conversation
orchestration resolves the current `preview_url` through that service before
calling the preview browser tool; Mastra tools do not query the project table.

`PortService` allocates and releases preview ports through Redis. Project creation acquires a port, creates project and conversation records, and queues scaffolding. Code-generation and project processors build or start/stop preview containers and update project status and preview metadata.

## Local server startup

- `pnpm start:dev`: runs Nest directly with watch mode. The host must provide application environment values, `DATABASE_URL`, Redis host/port, and SSH configuration.
- `infrastructure/local/up.sh`: starts Postgres and Redis with health waiting, runs `pnpm run db:migrate`, runs `pnpm run db:codegen`, builds the API image with `--no-cache`, and runs `docker compose up` in the foreground.
- `infrastructure/local/down.sh`: runs `docker compose down`.
- `infrastructure/local/restart.sh`: runs `docker compose down -v`, recreates Postgres and Redis, reruns migrations and DB code generation, rebuilds the API image without cache, and starts Compose. The `-v` removes the local Postgres volume and makes this a destructive reset.
- `docker compose up -d --build`: builds and starts the complete API, Redis, and Postgres stack in the background.

Compose publishes the API at port 3000, Redis at 6379, and Postgres at 5432. The API container is built from `Dockerfile` and runs `node dist/main.js`. The default API URL is `http://localhost:3000`.

Known gaps include direct preview URL exposure and Compose comments identifying unauthenticated local Redis/Postgres publication and hardcoded development credentials.
