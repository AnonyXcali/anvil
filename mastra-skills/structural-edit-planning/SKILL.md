---
name: structural-edit-planning
description: Use when producing file-change instructions, dependencies, ordering, and edit strategies.
---

# Structural Edit Planning

Every proposed file change must have an ownership and integration reason.

- Classify each file with `file_type`, `architectural_role`, and `operation`.
- Use only `depends_on` for prerequisites.
- Put dependencies in the plan before dependent files; preserve unrelated search order.
- Create directories before files within them.
- Prefer localized patches for existing-file changes when exact context is known.
- Use `replace_file` only for intentional complete-file rewrites.
- Keep line-range edits for backward compatibility when a patch or full replacement is not appropriate.
- Preserve imports, behavior, project conventions, and unrelated files.
- Include feature root, phases, directories, existing paths, and preservation constraints in `structure_plan`.
- Do not reveal technical structure or patches in the business-facing approval summary.
