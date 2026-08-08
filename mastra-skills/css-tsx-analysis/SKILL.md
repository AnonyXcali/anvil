---
name: css-tsx-analysis
description: Use for stylesheet changes, CSS reliability, selector ownership, and TSX/CSS integration analysis.
---

# CSS and TSX Analysis

For a stylesheet request, inspect both the stylesheet and the TSX files that import or use it.

- Find stylesheet imports before choosing ownership.
- Search JSX `className`, `id`, and relevant component selectors against the stylesheet.
- Check that selectors required by the TSX remain present after the proposed change.
- Check that important stylesheet selectors have a corresponding usage or intentional global role.
- Inspect responsive rules, focus states, pseudo-elements, and `#root` constraints when relevant.
- Prefer feature-local styles for feature components and reserve global styles for shared behavior.
- For complete stylesheet reconstruction, use `replace_file`; for focused changes, use a contextual patch.
