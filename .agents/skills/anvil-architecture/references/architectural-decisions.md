# Architectural decisions

These decisions describe the current implementation and should be revised when the architecture changes materially.

## ADR-001: Centralize Mastra registration

**Decision:** Register runtime agents and workflows in `src/mastra/index.ts`.

**Reason:** A single registry makes runtime exposure and dependency construction discoverable.

**Consequence:** Agent factories receive their infrastructure/workflow dependencies from the registry. Tools may be exposed transitively through registered agent factories.

## ADR-002: Use workflows for multi-stage agentic orchestration

**Decision:** The supervisor delegates frontend work to a durable workflow with search, plan, approval, compression, and edit stages.

**Reason:** Workflow steps provide explicit sequencing, suspension, resume, and state boundaries.

**Consequence:** The supervisor agent remains a routing/decision boundary, while workflow lifecycle is persisted and relayed by application services.

## ADR-003: Keep infrastructure behind services

**Decision:** Database, Redis, channels, SSH, filesystem, Docker, and port operations remain behind feature or infrastructure services.

**Reason:** Orchestration should not embed external-system implementation details.

**Consequence:** Workflows and agents depend on service capabilities rather than shell, SFTP, or database implementation.

## ADR-004: Persist workflow approval state in the application database

**Decision:** Store workflow ID, run ID, project, conversation, status, and suspended step in `preview_platform.workflow_run` in addition to Mastra snapshots.

**Reason:** The API and UI need an application-owned approval request and resume lookup.

**Consequence:** Supervisor and core services coordinate Mastra storage with application persistence.

## ADR-005: Use BullMQ for asynchronous processing

**Decision:** Long-running intent, conversation, agent, project, and code-generation work runs through BullMQ processors.

**Reason:** Requests can return job identifiers while workers handle long-running work and status updates.

**Consequence:** Application job records and BullMQ lifecycle events must remain aligned.

## ADR-006: Use Docker Compose for the local dependency stack

**Decision:** Local Docker scripts run API, Postgres, and Redis together, with `up.sh` handling migrations and DB type generation.

**Reason:** The application requires coordinated infrastructure for realistic local execution.

**Consequence:** `restart.sh` is a destructive database reset because it removes the Compose volume; host-based `pnpm start:dev` remains available when dependencies are provided externally.
