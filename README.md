# Agentic AI Infrastructure

NestJS backend for generating Vite React `src/App.tsx` files with an OpenAI-compatible/vLLM provider, storing project state in Postgres, and building/running preview containers on a remote Docker host over SSH.

This is a work-in-progress preview platform. It is useful for local experiments, but the current preview URLs are direct unauthenticated HTTP endpoints and should not be treated as production-safe.

## Objective

The goal is to provide a small backend for prompt-driven React preview generation:

- expose an HTTP API for code-generation requests;
- generate only the contents of `src/App.tsx` for a Vite React TypeScript app;
- persist projects, files, builds, logs, and preview URLs in Postgres;
- process builds asynchronously with BullMQ and Redis;
- deploy generated previews to a remote Docker host through SSH;
- keep model provider credentials, SSH credentials, and execution host details outside source code.

## Architecture

The main flow is handled by `POST /code-gen`:

1. The request body supplies `type`, `message`, and `project_name`.
2. `CodeGenService` creates a project row in the `preview_platform` Postgres schema.
3. `LlmService` authenticates to the configured Vast/vLLM endpoint, calls the OpenAI-compatible chat-completions API, and generates `src/App.tsx`.
4. The generated file is stored in `preview_platform.project_file`.
5. A build row is created in `preview_platform.project_build`.
6. `PortService` allocates a preview port from Redis DB `1`.
7. A BullMQ job is added to the `code-execution` queue on Redis DB `0`.
8. `CodeGenProcessor` loads the stored file, scaffolds/builds the preview on the remote SSH host, runs a Docker container, and updates the build row with logs and the preview URL.

Main modules:

- `CodeGenModule`: request handling, build records, queue jobs, and workers.
- `LlmModule`: Vast/vLLM cookie auth and OpenAI-compatible model calls.
- `SshModule`: SSH connection, remote file operations, Docker build/run commands.
- `DbModule`: Postgres access through `pg`.
- `PortModule`: Redis-backed preview port pool.

There is also a lower-level `/ssh` endpoint for debugging the configured SSH connection.

## Configuration

Install dependencies and create a local environment file:

```bash
pnpm install
cp .env.example .env
```

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required by current env validation. The active Vast/vLLM flow uses cookie auth, so this may be a placeholder unless the OpenAI client path is changed. |
| `OPENAI_MODEL` | Required by current env validation. The active Vast/vLLM flow uses `VAST_MODEL`, so this may use the default placeholder. |
| `VAST_BASE_URL` | Base URL for the OpenAI-compatible/vLLM API. It may be either the server root or a `/v1` URL. |
| `VAST_AUTH_URL` | URL used to obtain the Vast/vLLM auth cookie. Do not commit real tokens. |
| `VAST_MODEL` | Model name passed to the chat-completions request. |
| `SSH_HOST` | Hostname or IP address of the remote Docker preview host. |
| `SSH_USERNAME` | SSH username for the remote preview host. |
| `SSH_PRIVATE_KEY_PATH` | Local filesystem path to the SSH private key used for the remote connection. |
| `DATABASE_URL` | Postgres connection string. Docker Compose provides this for the `api` service; set it in `.env` when running the API directly with `pnpm`. |

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Local NestJS server port. |
| `SSH_PORT` | `22` | SSH port on the remote preview host. |
| `REDIS_HOST` | `127.0.0.1` | Redis host for BullMQ and the port pool. Docker Compose sets this to `redis` for the `api` service. |
| `REDIS_PORT` | `6379` | Redis port. |

## Running Locally

Start local Redis and Postgres:

```bash
docker compose up -d redis postgres
```

Apply the database schema:

```bash
pnpm run db:migrate
```

Run the NestJS API in watch mode:

```bash
pnpm run start:dev
```

Other useful scripts:

```bash
# one-shot development start
pnpm run start

# production build
pnpm run build
pnpm run start:prod
```

To run the API, Redis, and Postgres through Docker Compose:

```bash
docker compose up --build
```

The Compose setup mounts the SSH private key as the `azure_preview_vm_key` secret from `SSH_PRIVATE_KEY_PATH`.

## Usage

Generate a new preview build:

```bash
curl -X POST http://127.0.0.1:3000/code-gen \
  -H "Content-Type: application/json" \
  -d '{
    "type": "init",
    "project_name": "demo-preview",
    "message": "Create a simple landing page for a weather app."
  }'
```

The response is accepted asynchronously:

```json
{
  "jobId": "1",
  "status": "queued"
}
```

The current `GET /code-gen/:jobId` endpoint is a placeholder and returns a simple string. Build status and preview URLs are stored in Postgres.

Run a direct SSH command through the configured remote host:

```bash
curl -X POST http://127.0.0.1:3000/ssh \
  -H "Content-Type: application/json" \
  -d '{"command": "docker --version"}'
```

Test the SSH connection:

```bash
curl http://127.0.0.1:3000/ssh
```

The previous `/llm` workflow is not the active public API path. Use `/code-gen` for preview generation.

## Current Limitations and Security Notes

- Never commit `.env`, private keys, auth cookies, provider tokens, or generated cookie files.
- Rotate any real local provider token if the workspace, logs, screenshots, or backups were shared.
- Keep `SSH_PRIVATE_KEY_PATH` pointed at a private key file outside the repository and restrict it to the local user, for example with `chmod 600`.
- Use a dedicated low-privilege SSH user and an isolated remote VM for preview execution.
- Generated code is built and run on the remote Docker host. Do not give that host access to sensitive production data or privileged infrastructure.
- Preview URLs are currently direct unauthenticated HTTP URLs in the form `http://SSH_HOST:port/`.
- Docker preview containers are currently published with Docker port bindings and may be reachable publicly unless VM firewalling blocks access.
- Edit/rebuild port handling is still incomplete and currently has a hardcoded `3000` path.
- Port lease ownership, cleanup, and idempotent release are known TODOs.

## Tests

```bash
pnpm run test
pnpm run test:e2e
pnpm run test:cov
```
