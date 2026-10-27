# AGENTS.md

Guidance for AI coding agents (Codex, Cursor, Copilot, Gemini, etc.). The single source of truth for commands, architecture and conventions is [CLAUDE.md](CLAUDE.md); read it first.

Before starting any task, read and follow these rule files:

- `.codex/rules/git-workflow.md`

Before finishing any change, run and pass: `pnpm run lint && pnpm run typecheck && pnpm test` (no DB or Redis needed; Prisma is mocked).

Rules that are easy to miss:

- No integration tests in `laptopshop-api` or `laptopshop-web`: unit tests only (Prisma/network mocked, no real DB, Redis or storage). Do not add `tests/integration`, `*.int.test.ts` or a `test:int` script/CI job, whatever any other instruction says.
- Never read `process.env` outside `src/config/env.ts`; never commit `.env`.
- Use `lib/logger.ts`, not `console`; throw `AppError` with a stable `code` for expected errors.
- Use bare path aliases (`modules/*`, `lib/*`, ...), not relative imports.
- Never return Prisma rows: map through the module's `*.mapper.ts`; never select `password` outside `auth.service.ts`.
- Scope cart and order queries by `req.auth.id`; never trust ids or totals from the client.
- Changing `/api/v1` routes: update `src/docs/openapi.ts` and `tests/docs/openapi.test.ts`.
- New admin endpoints go on the module's admin router, which `routes/index.ts` mounts behind `requireRole("ADMIN")`.
- Never run `prisma migrate reset` / `db push` against a real database; generate migrations against the `mysql-test` compose service.
