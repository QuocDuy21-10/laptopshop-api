#!/bin/sh
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  ./node_modules/.bin/prisma migrate deploy
  node dist/seed.js
fi
exec "$@"
