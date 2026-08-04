#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../../../" && pwd)

cd "$REPO_ROOT"

pnpm exec ts-node --transpile-only --project tsconfig.json \
  .agents/skills/anvil-architecture/scripts/check-mastra-registration.ts
pnpm exec ts-node --transpile-only --project tsconfig.json \
  .agents/skills/anvil-architecture/scripts/check-module-boundaries.ts
