#!/bin/sh
set -e
npx prisma migrate deploy
node dist/seed.js
exec node dist/server.js
