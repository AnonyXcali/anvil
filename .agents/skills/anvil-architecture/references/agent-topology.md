# Agent Topology

This reference documents two different graphs: the Codex execution-team policy used to coordinate non-trivial repository work, and the Anvil agents that run in the application. The Codex roles are coordination guidance, not Mastra runtime registrations.

## Codex execution topology

### Roles and routing preferences

| Role | Preferred model | Effort | Responsibility | Exclusions |
| --- | --- | --- | --- | --- |
| Task Manager | GPT-5.5 | Low | Decompose requests into goals, dependencies, parallel workstreams, acceptance criteria, and risks. | Does not make architecture, code, infrastructure, quality, or scope decisions. |
| Lead Architect | GPT-5.6 Terra | High | Turn the decomposition into an architecture plan, assignments, boundaries, contracts, sequencing, risks, and documentation changes. | Does not implement the entire task or provide the only final sign-off. |
| Senior Developer 1 — Infrastructure | GPT-5.6 Luna | Medium | Own Docker, Redis, BullMQ, SSH/SFTP, filesystem, workspace, preview, deployment, runtime, and infrastructure-failure work. | Does not own backend domain logic or bypass security boundaries. |
| Senior Developer 2 — Backend | GPT-5.6 Luna | Medium | Own NestJS controllers/services/processors, persistence, APIs, event contracts, workflows, agents, request lifecycle, streaming, approvals, jobs, errors, and application tests. | Does not independently change infrastructure topology or bypass security boundaries. |
| Junior Developer | GPT-5.4 | Low | Perform trivial, mechanical, low-risk work with an explicit specification. | Does not make architecture, persistence, security, workflow-lifecycle, or broad-refactor decisions. |
| QA 1 — Functional Validation | GPT-5.5 | Medium | Validate acceptance criteria, behavior, integration, tests, and regression risk. | Does not silently redesign the implementation. |
| QA 2 — Architectural and Adversarial Review | GPT-5.5 | Medium | Challenge boundaries, contracts, recovery, security assumptions, edge cases, and architectural conformance. | Does not replace the Lead Architect or make unapproved scope changes. |

The model and effort declarations are preferred routing policy. They apply only when the agent runtime supports selecting those exact models and effort levels per sub-agent. Otherwise, use the closest available configuration while preserving the role and its responsibilities.

### Standard execution order

1. Spawn the Task Manager first.
2. Pass its decomposition to the Lead Architect.
3. Wait for the Lead Architect's architecture plan and task assignments.
4. Spawn implementation agents only after the plan is complete.
5. Integrate implementation outputs into one coherent change.
6. Spawn QA 1 and QA 2 after implementation and integration.
7. Return failed findings to the responsible implementation agent and re-run the affected validation.
8. Do not mark the task complete until both QA agents approve.

The Task Manager output should include a summary, goals, dependency graph, workstreams, acceptance criteria, and risks. The Lead Architect output should identify affected files, implementation order, shared contracts, architectural decisions, risks, and documentation updates.

### Assignment and coordination rules

- Infrastructure, Docker, Redis, BullMQ, SSH, SFTP, filesystem, runtime, and preview work goes to Senior Developer 1.
- NestJS, application logic, persistence, workflows, streaming, API contracts, backend orchestration, and agent behavior goes to Senior Developer 2.
- Trivial mechanical work goes to the Junior Developer.
- Architecture and cross-cutting decisions go to the Lead Architect; never assign those decisions to the Junior Developer.
- The Lead Architect establishes shared contracts before parallel implementation begins.
- Implementation agents must not independently change module boundaries, event contracts, persistence models, workflow lifecycle states, queue payloads, or security boundaries. Escalate necessary deviations to the Lead Architect.

Do not spawn the full topology for typo fixes, simple documentation edits, isolated renames, straightforward one-file changes, or tasks with no architectural or integration implications. For those tasks, use only the relevant implementation agent and, where necessary, one QA agent.

Escalate ambiguous specifications, cross-module boundary changes, security-sensitive decisions, persistence or workflow-lifecycle changes, contract trade-offs, and failed QA findings to the Lead Architect.

### Sign-off and final synthesis

The coordinating agent produces one final synthesis containing completion status, implemented goals, changed files, architectural decisions, tests and validation, QA 1's result, QA 2's result, unresolved risks, and documentation updates. Completion requires the implementation to be integrated, required tests and validation to pass, documentation to be current, and both QA agents to approve.

## Anvil runtime topology

The current Mastra runtime is centered on the supervisor agent and its frontend-engineering workflow:

```text
 Intent processor
 └── anvil-intent-agent
     └── ordered application-database history → structured intent (non-streaming)

Supervisor agent
└── frontendEngineeringWorkflow
    ├── search step
    │   └── Anvil Search Agent
    │       ├── read history
    │       ├── bounded repository search calls → SSH/workspace services
    │       └── tool-free Anvil Search Finalizer → legacy normalized handoff
    ├── plan step
    │   └── Anvil Planning Agent
    └── edit step
        └── Anvil Editing Agent
            ├── edit tools → editWorkflow
            └── verify step/workflow → Anvil Verify Agent
```

The runtime also registers `anvil-convo` for instant conversational requests. It
uses the project search tool plus separate Exa, Firecrawl, and Lightpanda-backed
tools. Its output is intentionally text-only: the conversation service relays
non-empty text deltas and hides tool, reasoning, and structured-output events
from the UI. Project resources such as the preview URL are resolved by
application services and supplied as explicit tool inputs; the Mastra graph has
no direct database dependency.

`anvil-intent-agent` is the internal classifier owned by `IntentService`. It
receives ordered history from the application database plus the current query
and returns structured `instant`, `offload`, or `unknown` output through
`agent.generate()`. It does not stream, persist, or publish user-facing chunks;
the processor uses the result only to select the next queue path.

The runtime roles are split across search, planning, editing, and verification agents. The supervisor owns top-level request orchestration; the frontend-engineering workflow owns the durable sequence and its step transitions. Editing tools may invoke the nested edit workflow, whose verification path uses local edit/read tools and the verify agent.

The search agent can use backend-bundled filesystem skills from `mastra-skills/`. These are concise, discoverable guidance playbooks for search sequencing, frontend structure, architecture history, CSS/TSX analysis, and structural edit planning. Skills are supplemental model guidance: request validation, sensitive-file rules, output schemas, dependency checks, and workflow behavior remain enforced by application code. Normal search is the production mode and permits bounded multi-search evidence collection; greedy is an explicit diagnostic mode that disables skills and permits one repository search call.

Search execution and structural planning are split into two model phases that share the same configured search model. The first phase is the tool-capable search agent: it reads `architecture/HISTORY.md` once, validates each chosen repository search request, and collects bounded evidence. The second phase is a tool-free finalizer agent that receives the user request plus all validated search evidence and returns only the compact structural edit plan (`files_that_require_change` and `structure_plan`). Application code then normalizes that compact result back into the legacy internal search handoff shape consumed by approval, compression, editing, and streaming logic. Normal mode allows up to 10 searches; greedy diagnostic mode allows one.

Agent runtime settings, including model identifiers and retry/error-processor policies, are centralized in `src/mastra/anvil-agent.config.ts`. Agent-specific instructions, tools, memory, and hooks remain with their agent factories.

The editing agent receives approved file metadata and edit instructions only. Runtime state such as the structural plan, verification flags, hashes, backups, local staging paths, errors, and commit status is excluded from the model-facing contract. The supervisor and edit workflows reconstruct and own that state.

All runtime agents, tools, workflows, and scorers must be reachable from centralized Mastra registration in `src/mastra/index.ts`. Tool exposure can be transitive through registered agent factories, and workflow-local scorers can be instantiated inside reachable workflows; they do not need separate top-level Mastra properties.

Approval checkpoints and `RequestContext` data cross the workflow boundary. Approval state is persisted so a suspended workflow can resume with the same workflow/run context. These boundaries should remain explicit when changing the runtime graph.

The approved structural plan is application-owned during editing. The supervisor stores it in the edit `RequestContext` and sends the editing agent a reduced file-instruction payload without runtime fields or repeated structural metadata. `run_edit_workflow` reconstructs the internal `FILE_EDIT[]` using that canonical plan; any legacy model-supplied `structure_plan` is ignored and reported only through sanitized diagnostics.

Known gaps and inconsistencies in the current runtime graph should be recorded here as current-state observations rather than silently treated as intended design.
