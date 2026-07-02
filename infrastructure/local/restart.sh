#!/bin/sh

set -e

# Reset the local database while the schema is still being developed.
docker compose down -v
docker compose up -d --wait postgres redis
pnpm run db:migrate
pnpm run db:codegen
docker compose build --no-cache api
docker compose up
