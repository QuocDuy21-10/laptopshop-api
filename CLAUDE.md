# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install`, then `npx prisma generate` and `npx prisma migrate dev` (MySQL). Copy `.env.example` to `.env`; `DATABASE_URL`, `JWT_SECRET` and `SESSION_SECRET` are required, and a Redis instance must be reachable at `REDIS_URL` (`docker compose up -d mysql redis`).
- `npm run dev`: nodemon running `ts-node -r tsconfig-paths/register src/server.ts`; `npm run start:debug` adds `--inspect=9229`
- `npm run build` (tsc + tsc-alias, copies `src/views` to `dist/views`), `npm start` runs `dist/server.js`
- `npm run lint`, `npm run typecheck`, `npm run format`
- `npm test` (Jest + Supertest, Prisma and Redis mocked, no DB needed); single test: `npx jest tests/path/file.test.ts -t "name"`

## Architecture

Express 5 + TypeScript + Prisma (MySQL) laptop shop. `src/server.ts` is the entrypoint: it imports `./instrument` first (Sentry, no-op without `SENTRY_DSN`), builds the Redis client, calls `createApp(deps)` from `src/app.ts`, seeds, listens, and shuts down gracefully on SIGTERM/SIGINT. `createApp` has no side effects, so tests import it with a `MemoryStore` and no Redis. The `registerExtras` dep is the hook for features that must mount before the 404/error handlers (used for Swagger).

All config goes through the Zod-validated `src/config/env.ts` (`env`); do not read `process.env` elsewhere. It fails fast at boot, and `ADMIN_PASSWORD` is required (>= 12 chars) in production.

One server serves two surfaces:

- **Server-rendered web app** (`src/routes/web.ts`, EJS views in `src/views/{admin,client,status}`): session auth via Passport local strategy (`middlewares/passport.local.ts`), sessions in Redis via `connect-redis`. `isAdmin` guards by checking `req.path.startsWith("/admin")` against `req.user.role.name === "ADMIN"`.
- **JSON REST API** under `/api` (`src/routes/api.ts`) for a separate SPA (CORS from `CORS_ORIGINS`): JWT auth via `checkValidJWT` in `middlewares/jwt.middleware.ts`, applied to the whole `/api` router with a path whitelist (`/login`, `/add-product-to-cart`). New public API endpoints must be added to that whitelist. The OpenAPI document in `src/docs/openapi.ts` is hand-registered per route; update it when changing `/api` routes. It is served at `/api-docs` only when `ENABLE_DOCS=true`.

Layering: `routes` → `controllers/{admin,client}` (files named `*.controller.ts`) → `services/{admin,client}` → Prisma (`config/client.ts` exports the shared `prisma`). Input validation uses Zod 3 schemas in `src/validation` (the project is on Zod 3; `@asteasolutions/zod-to-openapi` is pinned to 7.x for that reason). Errors: throw `AppError` (`lib/errors.ts`); `middlewares/error.middleware.ts` returns JSON under `/api` and renders `status/*.ejs` otherwise. Log with `lib/logger.ts` (pino), not `console`. File uploads go through `middlewares/multer.ts` into `public/`.

Rate limiting (`middlewares/rate-limit.ts`): global limiter plus a stricter one on `POST /login` and `POST /api/login`, backed by Redis in `server.ts`. Static files and `/healthz` / `/readyz` are mounted before session and limiter.

`config/seed.ts` (`initDatabase`) runs on startup and seeds roles, two admin users (password from `ADMIN_PASSWORD`, default `123456` outside production) and products only when those tables are empty.

Imports use bare path aliases from `tsconfig.json` (`config/*`, `controllers/*`, `middlewares/*`, `routes/*`, `services/*`, `views/*`, `validation/*`, `lib/*`, `docs/*`), not relative paths. There is no alias for the `src/` root, so `app`/`server`/`instrument` are imported relatively. `src/types/index.d.ts` augments `Express.User` with the Prisma `User` plus `role` and `sumCart`; it is pulled in via a triple-slash reference at the top of `app.ts`. Jest maps the same aliases in `jest.config.ts`: add new alias folders to both `tsconfig.json` and the `moduleNameMapper` regex.
