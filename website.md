# Anvil Developer Log Website

## Purpose

Build a minimal public-facing developer log website for this repository. The site should introduce Anvil, summarize what is currently being built, and let visitors follow development progress over time.

This should feel like a public build journal: closer to a README, changelog, or engineering notebook than a marketing-heavy SaaS landing page.

Repository link: `TODO: add public repository URL`

Status: `Active development`

## Next.js + Vercel Direction

Implement the first version as a small Next.js site intended for Vercel deployment.

- Use a single public route for the landing page and development log.
- Keep the page static for the first implementation.
- Store development log entries in a local TypeScript array.
- Do not add authentication, a backend API, a CMS, analytics, charts, or editing controls.
- Keep rendering logic separate from the local data array so the source can later move to Markdown files, Git commits, an API, or a database.

Suggested route: `/`

Suggested deployment target: Vercel

## Product Summary

Anvil is a backend for AI-assisted project workspaces. It supports authenticated conversations, routes user requests into background work, and produces React preview sandboxes that can be built and served through Docker-backed infrastructure.

The product is for developers experimenting with agentic project workflows where a conversation can become an immediate streamed answer or a source-aware implementation plan that updates a generated preview.

## Current Repository State

The committed repository currently represents a NestJS backend for authenticated AI conversations, agentic project work, and React preview sandboxes.

At a high level, the system includes:

- Project workspace management for generated preview work.
- Intent-based routing between instant conversation and project-change flows.
- Background job processing for long-running tasks.
- Redis-backed streaming for conversation text, workflow progress, approvals, and job updates.
- Postgres persistence for users, projects, conversations, messages, jobs, and generated files.
- Mastra-based agents for conversation, source search, planning, editing, verification, and approvals.
- Optional context from public web sources and the rendered project preview.
- SSH-backed Docker preview infrastructure for generated React apps.
- React preview generation, project editing, and preview lifecycle control.

## Current User Flows

An authenticated user starts from a project conversation. An internal intent step routes the request into one of two experiences:

- Instant conversation: the conversation agent responds in short, plain language while text is delivered live to the UI. It can use project context, public web information, or the current preview when relevant.
- Project change: the supervisor searches the project, presents a plan, waits for approval, then applies and verifies the approved changes before updating the preview.

The testing UI makes both paths observable. It shows the composed response, live workflow status, approval controls, completion or failure state, and the underlying stream events for debugging.

## Current Tech Stack

- NestJS
- TypeScript
- Better Auth
- OpenAI
- Mastra
- BullMQ
- Redis / ioredis
- Postgres / pg
- Kysely
- node-pg-migrate
- Zod
- Docker and SSH-backed preview infrastructure
- Jest
- ESLint
- Prettier
- pnpm

## Future Implementation

Future work should stay aligned with the committed repository direction:

- Continue improving the quality and efficiency of the current conversation and project-change flows.
- Expand verification and preview-aware feedback for generated applications.
- Improve preview isolation, authenticated preview URLs, and production-safe routing.
- Improve project job tracking and frontend polling around long-running work.
- Grow specialized tools for planning, editing, testing, building, and deploying generated apps.

## Page Structure

Use a simple single-column layout with comfortable reading width.

- Header with product name, one-line description, status, and repository link.
- Compact product summary.
- Current repository state section.
- Current tech stack section.
- Future implementation section.
- Development log heading.
- Internally scrollable development log block.
- Minimal footer with repository or author information.

Keep the top section compact. Avoid oversized hero copy, decorative images, feature grids, testimonials, pricing sections, or other marketing-page patterns.

## Development Log Data

Use sample data for the first version. These entries should demonstrate the intended content style and should not be treated as a complete source of truth for repository history.

```ts
type DevelopmentLogEntry = {
  id: string;
  title: string;
  timestamp: string;
  description: string;
};

const developmentLogEntries: DevelopmentLogEntry[] = [
  {
    id: 'chunk-based-conversation-delivery',
    title: 'Added request-scoped conversation streaming',
    timestamp: '6 August 2026, 22:36',
    description:
      'Improved live conversation delivery so instant replies stay associated with the right request while the testing UI can compose text, show progress, and preserve stream details.',
  },
  {
    id: 'context-aware-conversation-tools',
    title: 'Expanded conversational project context',
    timestamp: '6 August 2026, 21:50',
    description:
      'Enabled the conversation experience to use project search, relevant public web information, page content, and rendered preview context when answering questions.',
  },
  {
    id: 'testing-ui-workflow-console',
    title: 'Improved the workflow testing console',
    timestamp: '28 July 2026, 02:30',
    description:
      'Refined the internal testing interface so streamed progress, approvals, preview links, and debug information are easier to follow during agent runs.',
  },
  {
    id: 'supervisor-workflow-streaming',
    title: 'Expanded workflow streaming visibility',
    timestamp: '27 July 2026, 20:15',
    description:
      'Added clearer status updates for long-running agent workflows so planning, editing, verification, and completion can be tracked as they happen.',
  },
  {
    id: 'verification-loop-stability',
    title: 'Stabilized edit verification',
    timestamp: '27 July 2026, 19:20',
    description:
      'Improved the verification stage so generated file changes can be checked more reliably before they are promoted back into the preview workspace.',
  },
  {
    id: 'precise-remote-editing',
    title: 'Added precise remote file editing',
    timestamp: '26 July 2026, 15:40',
    description:
      'Introduced a safer edit flow that prepares local working copies, protects original files, applies targeted changes, verifies the result, and updates the remote workspace.',
  },
  {
    id: 'human-approval-flow',
    title: 'Added human approval before edits',
    timestamp: '25 July 2026, 22:10',
    description:
      'Added a human-in-the-loop checkpoint so proposed project changes can be reviewed and approved before the system applies them.',
  },
  {
    id: 'supervisor-agent-flow',
    title: 'Introduced the Supervisor Agent flow',
    timestamp: '24 July 2026, 18:30',
    description:
      'Moved complex frontend requests into a coordinated supervisor flow that can search the project, plan changes, request approval, and hand work to specialized editing agents.',
  },
  {
    id: 'ssh-project-tools',
    title: 'Expanded SSH-backed project tools',
    timestamp: '23 July 2026, 17:50',
    description:
      'Added project-scoped remote file operations to support safer preview workspace editing without exposing broad filesystem access.',
  },
  {
    id: 'docker-react-previews',
    title: 'Documented Docker-based React previews',
    timestamp: '14 July 2026, 18:30',
    description:
      'Summarized the preview workflow for generated Vite React projects served through SSH-backed Docker infrastructure.',
  },
  {
    id: 'ai-edit-planning',
    title: 'Documented AI-generated edit planning',
    timestamp: '14 July 2026, 17:45',
    description:
      'Captured the direction for source-aware agent workflows that inspect project context and produce implementation plans.',
  },
  {
    id: 'contextual-source-expansion',
    title: 'Documented contextual source expansion',
    timestamp: '14 July 2026, 16:50',
    description:
      'Added a sample log entry describing how nearby source context can support better agent decisions.',
  },
  {
    id: 'filename-content-search',
    title: 'Documented filename and content search',
    timestamp: '14 July 2026, 16:10',
    description:
      'Added a sample entry for source search capabilities used by agentic project workflows.',
  },
  {
    id: 'bullmq-background-jobs',
    title: 'Documented background job processing',
    timestamp: '14 July 2026, 15:20',
    description:
      'Summarized queue-backed processing for long-running project and agent tasks.',
  },
  {
    id: 'project-workspaces',
    title: 'Documented project workspace management',
    timestamp: '14 July 2026, 14:40',
    description:
      'Added a sample entry for isolated project workspaces used by generated preview flows.',
  },
];
```

Render entries newest first.

Each entry should include:

- Title
- Date and time
- Short description of what was added, changed, tested, or learned

## Visual Direction

Use a restrained developer-oriented aesthetic.

- Neutral background
- High text contrast
- Clean sans-serif font
- Optional monospace styling for timestamps and metadata
- Subtle borders or dividers between log entries
- Small corner radii
- Limited shadows
- No unnecessary animations
- No image assets required

The development log block should have a sensible maximum height and internal vertical scrolling while the rest of the page remains static.

## Accessibility

Use semantic page structure and accessible defaults.

- Use `main`, `header`, `section`, `article`, and `footer` where appropriate.
- Maintain proper heading hierarchy.
- Make links keyboard accessible.
- Provide visible focus states.
- Ensure readable contrast.
- Ensure the scrollable log container can receive keyboard focus and be scrolled with the keyboard.

## Acceptance Criteria

- The page immediately answers what Anvil is.
- The page summarizes the committed repository state without relying on uncommitted files.
- The page describes the current instant-conversation and project-change flows at a high level.
- The page lists the current tech stack at a high level.
- The page shows future implementation direction.
- The page shows recent development progress as sample local data in reverse chronological order.
- The page includes a place to follow the repository.
- The first implementation is a static Next.js page deployable on Vercel.
- The design remains minimal, responsive, accessible, and developer-oriented.
