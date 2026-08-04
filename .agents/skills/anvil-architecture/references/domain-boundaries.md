# Domain boundaries

## Module ownership

- `auth`: Better Auth configuration and authentication endpoints.
- `core`: user-facing conversation initiation, intent enqueueing, SSE relay, and workflow approval resume.
- `intent`: intent classification job processing.
- `conversation`: conversation message retrieval, persistence, and normal conversation jobs.
- `anvil-agent`: search-agent queueing, streaming, and search support.
- `anvil-agent-supervisor`: supervisor queue processing, workflow stream relay, and workflow-run persistence.
- `anvil-agent-edit`: edit capability service and durable edit workflow.
- `project`: project CRUD and start/stop job orchestration.
- `code-gen`: project scaffolding and code-generation queues.
- `channels`: Redis-backed chunk publication and storage.
- `job`: application job status persistence.
- `db`: Kysely database connection and generated types.
- `ssh`: remote workspace, filesystem, Docker, and command execution.
- `sharedredis`: Redis connection provider.
- `mastra`: Mastra instance registration and agent/tool/workflow factories.

## Boundary rules

Controllers and processors may call application services. Feature services may use shared infrastructure services. SSH, database, Redis, Docker, and filesystem implementation must remain behind their infrastructure services. Mastra registration belongs in `src/mastra/index.ts`; feature modules should not construct a second global Mastra registry.

Mastra tools are not persistence owners. They must not inject Kysely or query
Postgres directly. An owning application service resolves project resources and
passes them to tools through explicit input schemas. RequestContext is reserved
for execution metadata and authorization scope, not hidden resource lookup.

The validator enforces only explicit forbidden directions: infrastructure modules must not import feature orchestration modules, shared types must not import feature modules, and internal dependency cycles are errors. Existing cross-feature dependencies should be reviewed against module ownership before adding new ones.
