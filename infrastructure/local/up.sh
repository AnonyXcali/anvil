#!/bin/sh

set -e

docker compose up -d --wait postgres redis
pnpm run db:migrate
pnpm run db:codegen
docker compose build --no-cache api
docker compose up
