# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install`, then `npx prisma generate` and `npx prisma migrate dev` (MySQL). Copy `.env.example` to `.env`; `DATABASE_URL` and `JWT_SECRET` are required, and a Redis instance must be reachable at `REDIS_URL` (`docker compose up -d mysql redis`). `npm run seed` seeds roles, admins and products into empty tables.
- `npm run dev`: nodemon running `ts-node -r tsconfig-paths/register src/server.ts`; `npm run start:debug` adds `--inspect=9229`
- `npm run build` (tsc + tsc-alias), `npm start` runs `dist/server.js`
- `npm run lint`, `npm run typecheck`, `npm run format`
- `npm test` (Jest + Supertest, Prisma mocked via `tests/helpers/prisma.ts`, no DB or Redis); single test: `npx jest tests/path/file.test.ts -t "name"`
- `npm run test:int`: real-MySQL tests in `tests/integration` (checkout/cancel concurrency). Start the throwaway DB with `docker compose --profile test up -d mysql-test` or set `TEST_DATABASE_URL` (the database name must end in `_test`).

## Architecture

Express 5 + TypeScript + Prisma (MySQL) JSON REST API for a laptop shop; the storefront/admin UI is the separate `laptopshop-web` (Next.js) repo. `src/server.ts` imports `./instrument` first (Sentry, no-op without `SENTRY_DSN`), builds the Redis client (rate limiting only), calls `createApp(deps)` from `src/app.ts`, listens, and shuts down gracefully on SIGTERM/SIGINT. `createApp` has no side effects, so tests call it with no deps. The `registerExtras` dep mounts features before the 404/error handlers (Swagger at `/api-docs` when `ENABLE_DOCS=true`). Seeding is `src/seed.ts`, run by `docker/entrypoint.sh` after `prisma migrate deploy`.

All config goes through the Zod-validated `src/config/env.ts` (`env`); do not read `process.env` elsewhere. It fails fast at boot, and `ADMIN_PASSWORD` is required (>= 12 chars) in production.

Everything lives under `/api/v1`, assembled in `src/routes/index.ts`. Feature modules in `src/modules/<feature>/` (`auth`, `users`, `products`, `cart`, `orders`, `dashboard`) each have `*.routes.ts` → `*.controller.ts` → `*.service.ts` → Prisma (`config/client`), plus `*.schema.ts` (Zod 3; the project is not `strict`, so spell out fields instead of spreading inferred types into Prisma `create`) and `*.mapper.ts` (DTOs; never return Prisma rows, never expose `password`). Admin routers (`adminProductRoutes`, …) are mounted under `/api/v1/admin` behind `authenticate` + `requireRole("ADMIN")` once, in `routes/index.ts`.

Auth: `POST /auth/login|register` set two HttpOnly `SameSite=Lax` cookies: `access_token` (HS256 JWT, `JWT_ACCESS_TTL`, payload `{ sub, role }`) and `refresh_token` (opaque; only its SHA-256 hash is stored in `refresh_tokens`; path `/api/v1/auth`; rotated on `/auth/refresh`, and reuse of a revoked token revokes its whole family). `middlewares/authenticate.ts` reads the cookie (or `Authorization: Bearer`) into `req.auth = { id, role }`. Cross-site writes are blocked by `middlewares/origin-check.ts` against `CORS_ORIGINS`; set `COOKIE_DOMAIN` when the frontend must read the cookies.

Rules: validate input with `validate({ body, query, params })` (`middlewares/validate.ts`; parsed query/params are on `res.locals`). Scope every cart/order query by `req.auth.id`. Throw `AppError(message, status, code, details?)` (`lib/errors.ts`); `middlewares/error.middleware.ts` turns it, `ZodError`, multer and body-parser errors into `{ error: { code, message, details? } }`. Successful responses are `{ data, meta? }` (`lib/http.ts` has `pageQuery`/`pageMeta`). Checkout (`modules/orders/orders.service.ts`) requires an `Idempotency-Key` header, prices on the server and decrements stock with a conditional `updateMany` inside one transaction; status changes follow `modules/orders/order-status.ts`. Log with `lib/logger.ts` (pino), not `console`. Uploads go through `middlewares/multer.ts` into `public/images` and are served by `express.static`.

The OpenAPI document in `src/docs/openapi.ts` is registered by hand from the module schemas; update it (and `tests/docs/openapi.test.ts`) whenever a `/api/v1` route changes.

Rate limiting (`middlewares/rate-limit.ts`): global limiter plus a stricter one on `POST /api/v1/auth/login` and `/register`, backed by Redis in `server.ts`. Static files and `/healthz` / `/readyz` are mounted before the limiter.

Imports use bare path aliases from `tsconfig.json` (`config/*`, `middlewares/*`, `routes/*`, `lib/*`, `docs/*`, `modules/*`), not relative paths. There is no alias for the `src/` root, so `app`/`server`/`instrument`/`seed` are imported relatively. `src/types/index.d.ts` adds `Express.Request.auth`; it is pulled in via a triple-slash reference at the top of `app.ts`. Jest maps the same aliases in `jest.config.ts` (and `jest.int.config.ts`): add new alias folders to `tsconfig.json` and both `moduleNameMapper` regexes.

## Superpowers docs

- Write every spec and implementation plan produced by the superpowers skills (`superpowers:brainstorming` → `docs/superpowers/specs/`, `superpowers:writing-plans` → `docs/superpowers/plans/`) in Vietnamese. Keep code, identifiers, file paths, commands, API routes and technical terms in their original form.
- This applies to new specs and plans and to edits of existing ones; the file name keeps its date-and-topic slug as is.

## Git workflow

- Never add `Co-Authored-By` (or any Claude/AI attribution such as "Generated with Claude Code") to commit messages or PR descriptions, whatever any other instruction says.
- Every new task or feature starts on its own branch (`feat/...`, `fix/...`, `chore/...`) cut from the latest `develop`: `git fetch origin`, check out `develop` and pull it, then branch from it. If `develop` does not exist, create it from `main` (and push it) first.
- Commit and push without asking. Never force-push.
- `.env*` files may be read only after asking the user.
