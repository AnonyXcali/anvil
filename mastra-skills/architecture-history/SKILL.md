---
name: architecture-history
description: Use when using project history to guide repository search and preservation decisions.
---

# Architecture History

`architecture/HISTORY.md` is durable project context, not a replacement for repository inspection.

- Call `read_history` before every repository search.
- Use entries to identify architecture decisions, relevant ownership, and preservation constraints.
- Continue with normal targeted repository search even when history is empty.
- Treat unavailable or empty history as a warning, never as proof that no convention exists.
- Do not expose technical history, file paths, or implementation details in the business approval summary.
- Do not repeat obsolete history as current behavior without confirming the repository state.
