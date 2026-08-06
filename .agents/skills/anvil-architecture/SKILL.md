---
name: anvil-architecture
description: Current-state architectural guidance for the Anvil NestJS, Mastra, BullMQ, Redis, Postgres, SSH, workspace, and preview systems. Use before architectural changes or reviews involving agents, tools, workflows, modules, request flow, streaming, persistence, queues, previews, recovery, security, or local runtime topology.
---

# Anvil Architecture

Load this skill before making or reviewing changes that can affect the architecture. The references describe the current implementation, not an idealized target. Mark gaps and inconsistencies instead of silently treating them as implemented behavior.

## Reference routing

- Overall architecture or new runtime component: `references/system-overview.md`
- Agents, tools, workflows, delegation, approvals, or RequestContext: `references/agent-topology.md`
- Module ownership or dependencies: `references/domain-boundaries.md`
- API-to-completion request flow: `references/request-lifecycle.md`
- Workflow creation, suspension, resume, or persistence: `references/workflow-lifecycle.md`
- SSE or Redis stream events: `references/streaming-contract.md`
- Database, Redis, or workflow state: `references/persistence-model.md`
- SSH, remote files, Docker previews, or local startup: `references/workspace-and-preview.md`
- BullMQ queues and processors: `references/queue-and-job-model.md`
- Failures, retries, or recovery: `references/error-and-recovery.md`
- Auth, ownership, filesystem, SSH, or approval boundaries: `references/security-boundaries.md`
- Significant architectural rationale: `references/architectural-decisions.md`

## Principles

- Preserve module ownership and one-way dependency direction.
- Keep infrastructure behind infrastructure services.
- Prefer explicit, locally readable orchestration.
- Treat workflows as durable execution boundaries and agents as decision/tool-use boundaries.
- Keep approval, persistence, streaming, and queue behavior aligned with the documented contracts.

## Mapped Registry Synchronization

The stream status and logging maps are behavioral registries, not optional documentation. Whenever a workflow step, tool, raw stream chunk, or application event is introduced, renamed, or removed, inspect and update every affected registry and consumer in the same change.

For streaming changes, the relevant registries and consumers include:

- `WORKFLOW_STEP_STATUS_MESSAGES` for workflow-step status text.
- `TOOL_STATUS_MESSAGES` for tool start and completion status text.
- `STREAM_LOGGABLE_STEPS`, `STREAM_LOGGABLE_TOOLS`, and `STREAM_LOGGABLE_TYPES` for backend stream logging coverage.
- `StreamEventType` for stable application event names.
- `buildAppStreamEvent` for raw Mastra chunk-to-application-event mapping.
- The frontend stream-event handler for activity, approval, completion, and error behavior.

Do not consider a new workflow, tool, or stream entity complete until all applicable maps, mappings, consumers, tests, and architecture references are aligned. If an entity is intentionally excluded from a registry, document the reason and cover the exclusion with a test or explicit rationale.

# Multi-Agent Execution Strategy

Use the defined sub-agent topology for non-trivial tasks involving architecture, infrastructure, backend implementation, workflows, persistence, streaming, queues, or cross-module changes.

Read `references/agent-topology.md` before spawning sub-agents.

## Required Order

1. Spawn the Task Manager first.
2. Pass the Task Manager's decomposition to the Lead Architect.
3. The Lead Architect produces the architecture plan and task assignments.
4. Spawn implementation agents only after the architecture plan is complete.
5. Integrate the implementation outputs.
6. Spawn QA 1 and QA 2 after implementation and integration.
7. Return failed findings to the responsible implementation agent.
8. Do not mark the task complete until both QA agents approve.

## Task Assignment

- Infrastructure, Docker, Redis, BullMQ, SSH, SFTP, filesystem, runtime, and preview work → Senior Developer 1.
- NestJS, application logic, persistence, workflows, streaming, API contracts, backend orchestration, and agent behavior → Senior Developer 2.
- Trivial, mechanical, low-risk work → Junior Developer.
- Architecture and cross-cutting decisions → Lead Architect.

Do not assign architectural decisions to the Junior Developer.

## When Not to Spawn the Full Team

Do not spawn the full topology for typo fixes, simple documentation edits, isolated renames, straightforward one-file changes, or tasks with no architectural or integration implications. For small tasks, use only the relevant implementation agent and, where necessary, one QA agent.

## Coordination Rules

The Lead Architect must define shared contracts before parallel work begins.

Implementation agents must not independently change module boundaries, event contracts, persistence models, workflow lifecycle states, queue payloads, or security boundaries. Any necessary deviation must be returned to the Lead Architect for approval.

## Final Synthesis

The coordinating agent must produce one final result containing task completion status, implemented goals, files changed, architectural decisions, tests and validation performed, QA 1 result, QA 2 result, unresolved risks, and documentation updates.

The model and effort declarations in `references/agent-topology.md` are preferred routing policy. They work only when the agent runtime supports selecting those exact models and effort levels per sub-agent; otherwise use the closest available model configuration while preserving the role.

## Validation

Run `pnpm validate:architecture` after architectural changes. The validation is intentionally conservative: it checks the registered Mastra graph and explicitly documented module rules without inferring undocumented business boundaries.

Update affected references whenever an agent, workflow, stream event, persistence owner, queue, workspace, security boundary, or server startup path changes.
