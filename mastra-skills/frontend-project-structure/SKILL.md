---
name: frontend-project-structure
description: Use when locating frontend ownership, routes, layouts, feature folders, styles, or shared primitives.
---

# Frontend Project Structure

Treat the actual repository as authoritative and the scaffold map as a routing heuristic.

- Treat `src/app/App.tsx` as the application shell, not the default feature destination.
- Treat `src/app/App.css` as app-level or global styling, not the default feature stylesheet.
- Prefer `src/features/<domain>` for feature behavior and feature-owned styles.
- Check `src/pages` for route-level screens and `src/app/layouts` for shell/layout ownership.
- Check `src/ui-primitives`, `src/hooks`, `src/lib`, and `src/types` before creating shared equivalents.
- Inspect route registration and imports before proposing new pages or routes.
- Preserve existing project conventions and avoid unrelated cleanup.

For substantial work, report the feature root, directories to create, architectural roles, dependencies, and preservation constraints in the final structural plan.
