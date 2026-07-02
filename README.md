# Ship forge

Ship forge is a NestJS backend for AI conversations and React preview generation.

The main flow lives in [`src/core/`](src/core/). It creates authenticated conversations, classifies user intent, queues background work, and streams model responses back to the client.

## What it does

- Runs authenticated AI conversations with Better Auth sessions.
- Uses OpenAI with bring-your-own-key support through `.env`.
- Streams assistant responses with Redis Pub/Sub and Server-Sent Events.
- Stores users, conversations, messages, jobs, projects, and generated files in Postgres.
- Supports direct React `src/App.tsx` preview generation on a user-provided SSH host.
- Uses BullMQ queues for long-running work.

## Main architecture

- `CoreModule`: starts and continues user conversations.
- `IntentModule`: classifies each user request as instant or offloaded work.
- `ConversationModule`: handles normal model responses.
- `LlmModule`: wraps OpenAI calls.
- `ChannelsModule`: streams response chunks over Redis and SSE.
- `CodeGenModule`: generates and edits React previews.
- `SshModule`: writes files and runs Docker previews on a remote host.
- `AuthModule`: handles Better Auth sign-up and sign-in.

## Core flow

`POST /core` starts a new authenticated conversation.

```json
{
  "query": "Explain how React state works"
}
```

Response:

```json
{
  "job_id": "1",
  "conversation_id": "conversation-uuid"
}
```

`POST /core/talk` adds a message to an existing conversation.

```json
{
  "query": "Can you explain that with an example?",
  "conversation_id": "conversation-uuid"
}
```

`GET /core/:conversation_id` opens the SSE stream for model chunks.

## Code generation flow

`POST /code-gen` creates a React preview by generating `src/App.tsx`.

```json
{
  "project_name": "demo-preview",
  "message": "Create a simple weather app"
}
```

`POST /code-gen/edit` updates an existing preview.

```json
{
  "project_id": "project-uuid",
  "message": "Make the header blue"
}
```

The preview worker stores generated code in Postgres, allocates a Redis-backed port, connects to the configured SSH host, writes the React file, builds a Docker image, and runs the preview container.

## Queues

Ship forge uses BullMQ for async work.

| Queue | Purpose |
| --- | --- |
| `intent-execution` | Classifies user intent from `/core`. |
| `conversation-processor` | Generates streamed assistant responses. |
| `code-execution` | Builds a new React preview. |
| `edit-code-execution` | Updates an existing React preview. |

## Auth

Better Auth provides email and password auth.

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/sign-up` | Creates a user and sets auth cookies. |
| `POST /auth/sign-in` | Signs in a user and sets auth cookies. |

The `/core` flow reads the authenticated session user.

## Configuration

Create a local environment file:

```bash
cp .env.example .env
```

Important variables:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI API key supplied by the user. |
| `OPENAI_MODEL` | Model used for intent and conversation calls. |
| `BETTER_AUTH_SECRET` | Better Auth signing secret. |
| `BETTER_AUTH_URL` | Base URL used by Better Auth. |
| `REDIS_HOST` | Redis host. |
| `REDIS_PORT` | Redis port. |
| `SSH_HOST` | Remote preview host or IP. |
| `SSH_PORT` | Remote SSH port. |
| `SSH_USERNAME` | SSH username. |
| `SSH_PRIVATE_KEY_PATH` | Local path to the SSH private key. |

The current env validation also requires `VAST_BASE_URL`, `VAST_AUTH_URL`, and `VAST_MODEL`. They are legacy provider settings and are not the active OpenAI path.

Docker Compose supplies `DATABASE_URL` for the API container. Set it manually when running the API outside Compose.

## Running locally

Install dependencies:

```bash
pnpm install
```

Start Redis and Postgres:

```bash
docker compose up -d redis postgres
```

Apply migrations:

```bash
pnpm run db:migrate
```

Run the API:

```bash
pnpm run start:dev
```

Run the full Compose stack:

```bash
docker compose up --build
```

## API examples

Sign up:

```bash
curl -X POST http://127.0.0.1:3000/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo User","email":"demo@example.com","password":"password123"}'
```

Sign in:

```bash
curl -X POST http://127.0.0.1:3000/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"password123"}'
```

Start a conversation:

```bash
curl -X POST http://127.0.0.1:3000/core \
  -H "Content-Type: application/json" \
  -d '{"query":"What is a React component?"}'
```

Generate a preview:

```bash
curl -X POST http://127.0.0.1:3000/code-gen \
  -H "Content-Type: application/json" \
  -d '{"project_name":"demo-preview","message":"Create a calculator app"}'
```

## Current limitations

- `/core` handles instant conversation flow today.
- Agentic code generation from `/core` is planned.
- `/code-gen` is the current direct React preview path.
- Preview URLs are direct HTTP URLs from the SSH host and port.
- Remote preview hosts should be isolated and low privilege.
- Do not commit `.env`, private keys, auth secrets, or provider keys.

## Future direction

The offload path from `/core` will route to agentic React code generation.

Future agents will use specialized tools for planning, editing, searching, building, and deploying React codebases.

## Scripts and tests

```bash
pnpm run build
pnpm run start
pnpm run start:dev
pnpm run test
pnpm run test:e2e
pnpm run test:cov
pnpm run db:migrate
pnpm run db:rollback
pnpm run db:codegen
```
