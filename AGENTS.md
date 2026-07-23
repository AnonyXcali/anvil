# AGENTS.md

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

## Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly
- In Mastra step `execute` callbacks, do not destructure context methods such as `bail` or `suspend`; call them through the context object to avoid `@typescript-eslint/unbound-method` lint errors.
- Prefer direct `MastraService` injection from `@mastra/nestjs` in Nest services that need Mastra access. Do not use `ModuleRef` lazy lookup for `MastraService` unless a real circular dependency is proven and documented.
- Use `SshService.runStep(...)` for shell commands in `ssh.service.ts` so command logging is consistent. SFTP operations such as `getFile(...)` and `putFile(...)` are not shell commands, but should be surrounded by `runStep(...)` verification where useful.

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)
- [Nest JS](https://docs.nestjs.com/)
- [Nest JS Rendering](https://docs.nestjs.com/techniques/mvc)
