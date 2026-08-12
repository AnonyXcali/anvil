# Persistence model

Postgres is the system of record for users, projects, conversations, messages, application jobs, project jobs, and workflow runs. Kysely types are generated into `src/db/db.types.ts`; migrations live under `migrations/`.

Redis is used for BullMQ queues and channel chunks. `ChannelsService` owns publication and storage of stream chunks, while `SharedredisModule` provides Redis connectivity. Mastra uses PostgreSQL storage in the `mastra` schema for agent memory and workflow snapshots, with LibSQL retained as the composite store's fallback for other domains and DuckDB used for observability. The memory and workflow domains must not depend on the API container filesystem.

Workflow approval state has two layers: Mastra stores workflow snapshots, while `preview_platform.workflow_run` stores application-facing workflow ID, run ID, project, conversation, status, suspended step, and (for supervisor-owned approvals) `resume_agent_id`, `resume_tool_call_id`, and `resume_tool_name`. `CoreService` and `AnvilAgentSupervisorService` own the application workflow-run lifecycle.

Conversation history is stored in `preview_platform.message` and reconstructed
by `sequence_number ASC`. User requests are written before queueing. The
central stream publisher persists transcript-visible assistant text, approval
summaries, and user-facing workflow errors; progress, tool status, raw Mastra
diagnostics, patches, and repair prompts are excluded. The instant conversation
worker avoids appending a user query that is already the latest stored message.

Persistence ownership should remain with the module that owns the entity or external store. Do not duplicate database access in an orchestration layer merely to avoid calling the owning service.

Milestone repair state is application-owned in `edit_transaction`,
`edit_milestone`, and `edit_bug`. The database is authoritative for lifecycle,
attempt budget, and stable bug status. The local `.anvil-manifest.json` and
staging root are retained on partial completion and reopened by the separate
repair supervisor run. `BUGS.md` contains unresolved project-facing entries;
successful repair removes entries by stable bug ID and appends resolution
metadata to `HISTORY.md`.

Mastra agents and tools do not own application persistence. `ProjectService`
resolves project preview metadata for conversation orchestration, and the
browser tool receives the resulting preview resource through its input schema.
