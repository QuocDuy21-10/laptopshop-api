#!/bin/sh
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  pnpm exec prisma migrate deploy
  node dist/seed.js
fi
exec "$@"
