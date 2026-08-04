# Persistence model

Postgres is the system of record for users, projects, conversations, messages, application jobs, project jobs, and workflow runs. Kysely types are generated into `src/db/db.types.ts`; migrations live under `migrations/`.

Redis is used for BullMQ queues and channel chunks. `ChannelsService` owns publication and storage of stream chunks, while `SharedredisModule` provides Redis connectivity. Mastra uses LibSQL storage for Mastra state and DuckDB for observability in the current registration.

Workflow approval state has two layers: Mastra stores workflow snapshots, while `preview_platform.workflow_run` stores application-facing workflow ID, run ID, project, conversation, status, and suspended step. `CoreService` and `AnvilAgentSupervisorService` own the application workflow-run lifecycle.

Persistence ownership should remain with the module that owns the entity or external store. Do not duplicate database access in an orchestration layer merely to avoid calling the owning service.

Mastra agents and tools do not own application persistence. `ProjectService`
resolves project preview metadata for conversation orchestration, and the
browser tool receives the resulting preview resource through its input schema.
