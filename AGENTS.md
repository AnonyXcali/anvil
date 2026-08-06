# AGENTS.md

## CRITICAL: Load `anvil-architecture` for architectural work first

Load `.agents/skills/anvil-architecture/SKILL.md` before changing or reviewing agents, tools, workflows, orchestration, modules, request or workflow lifecycles, streaming, persistence, queues, previews, recovery, security, or server/runtime topology.

## CRITICAL: Load `mastra` skill for MASTRA agents related tasks

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge—APIs change between versions.

## Rules

### Mastra

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`.
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly.
- In Mastra step `execute` callbacks, do not destructure context methods such as `bail` or `suspend`; call them through the context object to avoid `@typescript-eslint/unbound-method` lint errors.
- Prefer direct `MastraService` injection from `@mastra/nestjs` in Nest services that need Mastra access. Do not use `ModuleRef` lazy lookup for `MastraService` unless a real circular dependency is proven and documented.
- Mastra tools must not inject Kysely, `KYSELY_DB`, `DbModule`, or any database client, and must not query application persistence directly.
- Project resources required by a Mastra tool must be resolved by their owning application service and passed as explicit, schema-validated tool inputs. `RequestContext` may carry execution metadata or authorization scope, but it must not replace resource inputs.

### SSH

- Use `SshService.runStep(...)` for shell commands in `ssh.service.ts` so command logging is consistent.
- SFTP operations such as `getFile(...)` and `putFile(...)` are not shell commands, but should be surrounded by `runStep(...)` verification where useful.

### Function Extraction & Readability

Readability of the execution flow takes precedence over minimizing function length.

#### Keep orchestration local

Controllers, services, processors, workflows, and agents are orchestration code.

The primary execution path should be understandable from top to bottom without repeatedly jumping through helper methods.

It is acceptable for orchestration methods to be longer if doing so keeps the execution flow cohesive and easy to follow.

Do not extract helper methods solely to reduce the number of lines in a function.

#### Only extract when there is architectural value

Extract a function only if at least one of the following is true:

- It represents a meaningful domain operation.
- It is reused.
- It hides substantial implementation detail.
- It encapsulates infrastructure concerns (database, Redis, filesystem, SSH, HTTP, external APIs, etc.).
- It forms a useful testing boundary.

Otherwise, prefer keeping the logic inline.

#### Avoid low-value helpers

Avoid helper methods that:

- Are called only once.
- Only construct an object or payload.
- Only perform simple branching.
- Only perform null checks.
- Simply wrap another helper.
- Exist primarily to reduce line count.

These generally increase cognitive load by forcing unnecessary navigation.

#### Prefer locality of reference

A reader should be able to understand a feature by reading one method from top to bottom.

Prefer one cohesive orchestrator over many small helper methods.

When deciding whether to extract code, ask:

> Does this helper reduce cognitive load, or does it merely move code elsewhere?

If it merely moves code elsewhere, keep it inline.

Default to fewer functions, not more. Every new helper should justify its existence.

## Resources

- https://mastra.ai/llms.txt
- https://mastra.ai/.well-known/skills/index.json
- https://docs.nestjs.com/
- https://docs.nestjs.com/techniques/mvc
