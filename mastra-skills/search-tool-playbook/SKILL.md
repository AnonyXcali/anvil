---
name: search-tool-playbook
description: Use when selecting or sequencing Anvil repository search operations.
---

# Search Tool Playbook

Use the repository search tool to inspect the project. Search is read-only.

## Sequence

1. Read `architecture/HISTORY.md` before the first repository search.
2. Use `file_search` for likely paths and domain terms.
3. Use `content_search` after candidate paths are known.
4. Use `expand_context` only after content matches identify the file and line area needed for an exact instruction.
5. Stop when the relevant implementation context, ownership, imports, and preservation constraints are known.

## Request rules

- `expand_context` always requires a project-relative `file_name`.
- `expand_context` always requires a non-empty `ranges` array.
- Every range must contain positive integer `startLine` and `endLine` values.
- `startLine` must be less than or equal to `endLine`.
- Never send `ranges: null` for `expand_context`.
- Keep search history concise and describe the intent of each call.

If the needed line range is unknown, use `content_search` first. Do not guess a null or missing range.
