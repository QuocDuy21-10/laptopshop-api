# SDD ledger — plan: docs/superpowers/plans/2026-10-20-advanced-product-facets.md

Execution method: Native / executing-plans.
API workspace: `/Users/dinhduy/Workspace/nodejs/laptopshop-api` on `codex/advanced-product-facets-design`.
Web workspace: `/Users/dinhduy/Workspace/nodejs/laptopshop-web`; create/use `codex/advanced-product-facets` before web tasks.

## Pre-flight

- API branch is clean and non-main; spec commit `94f7850` and plan commit `49d53e4` are present.
- Web repository starts clean on `main`; implementation must branch before Task 7.
- TDD skill loaded before Task 1.
- `sdd-workspace` helper required `bash`; the first Python invocation was a tooling mistake, not a project failure.

### Shared interfaces

- Task 1 → Task 2: facet registry value types and `productFilterFields` are consumed by normalization/body schemas. Verify names before Task 2.
- Task 1 → Task 4: `ProductFacetKey`, bucket predicates and `ProductFilterQuery` are consumed by the shared Prisma builder.
- Task 1/2 → Task 5: registry SQL metadata and normalized Product columns are consumed by aggregate SQL.
- Task 1/5 → Task 6: parsed facet query, public definitions and `getProductFacets` are consumed by the HTTP handlers/OpenAPI contract.
- Task 6 → Task 7: live OpenAPI paths/schemas are the only source for generated web types and Admin form fields.
- Task 7/8 → Task 9: generated `FacetDefinition`, `ProductFacets`, URL model and query helpers are consumed by controlled filters.
- Task 8/9 → Task 10: canonical filter model and controlled `FilterControls` are consumed by mobile draft/preview.
- Task 8/9/10 → Task 11: server/client data access and UI adapters are consumed by ProductsPage integration/cache/SEO.
- Task 11 → Task 12: complete page contract and cache behavior are consumed by E2E and final verification.

### Rulings

- None yet.

- Task 2: Ruling: Advisor candidates keep normalized fields optional and the rule-based mapper fills missing values with `null` — existing advisor fixtures construct partial Product projections, while the generated Prisma Product now has five additional nullable fields; this preserves advisor behavior and restores type safety — cost if wrong: advisor output could omit a normalized field if the mapper fallback is removed.
- Task 3: Ruling: add the missing `scripts/*` Jest/TypeScript alias — the audit command is a first-class `src/scripts` module and the repository import convention disallows relative imports; cost if wrong: one additional alias surface to maintain.

### Baseline

- API: `npm test -- --runInBand` → 50 suites / 369 tests passed. Watchman emitted recrawl warnings only.
- Web: `npm test` → 49 files / 177 tests passed. Existing jsdom `getComputedStyle`/navigation warnings only.

## Task status

- Task 1: pending
- Task 2: pending
- Task 3: pending
- Task 4: pending
- Task 5: pending
- Task 6: pending
- Task 7: pending
- Task 8: pending
- Task 9: pending
- Task 10: pending
- Task 11: pending
- Task 12: pending
Task 1: complete (commits 49d53e4..76013a0, tests: npm test -- tests/modules/products/products.schema.test.ts tests/modules/products/products.routes.test.ts tests/modules/products/admin-products.routes.test.ts --runInBand → Watchman:  watchman --no-pretty get-sockname returned with exit code=1, signal=null, stderr= 2026-10-20T21:38:48,773: [] fchmod(/Users/dinhduy/.local/state/watchman/dinhduy-state, 2700): Operation not permitted)
Task 2: complete (commits 76013a0..8bb6749, tests: npm test -- tests/modules/products/products.normalization.test.ts tests/modules/products/admin-products.routes.test.ts tests/config/seed.test.ts --runInBand → Watchman:  watchman --no-pretty get-sockname returned with exit code=1, signal=null, stderr= 2026-10-20T21:42:51,101: [] fchmod(/Users/dinhduy/.local/state/watchman/dinhduy-state, 2700): Operation not permitted)
Task 3: complete (commits 8bb6749..2f54216, tests: npm test -- tests/scripts/audit-product-facets.test.ts --runInBand → Watchman:  watchman --no-pretty get-sockname returned with exit code=1, signal=null, stderr= 2026-10-20T21:44:19,037: [] fchmod(/Users/dinhduy/.local/state/watchman/dinhduy-state, 2700): Operation not permitted)
Task 4: complete (commits 2f54216..8075dfb, tests: npm test -- tests/modules/products/products.filter.test.ts tests/modules/products/products.routes.test.ts tests/modules/products/admin-products.routes.test.ts --runInBand → Watchman:  watchman --no-pretty get-sockname returned with exit code=1, signal=null, stderr= 2026-10-20T21:45:54,597: [] fchmod(/Users/dinhduy/.local/state/watchman/dinhduy-state, 2700): Operation not permitted)
Task 5: complete (commits 8075dfb..437db49, tests: npx jest -c jest.int.config.ts --runInBand tests/integration/product-facets.int.test.ts → Watchman:  watchman --no-pretty get-sockname returned with exit code=1, signal=null, stderr= 2026-10-20T21:48:36,489: [] fchmod(/Users/dinhduy/.local/state/watchman/dinhduy-state, 2700): Operation not permitted)
Task 6: complete (commits 437db49..d9ed84c, tests: npm test -- tests/modules/products/products.routes.test.ts tests/docs/openapi.test.ts --runInBand → Watchman:  watchman --no-pretty get-sockname returned with exit code=1, signal=null, stderr= 2026-10-20T21:51:16,750: [] fchmod(/Users/dinhduy/.local/state/watchman/dinhduy-state, 2700): Operation not permitted)
Final review: important issue fixed in f46ee56 — in-stock facet now emits public value `true` (not SQL threshold literal `1`); integration coverage passes.
