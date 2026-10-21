# Advanced Product Facets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng bộ lọc laptop đầy đủ với normalized product attributes, self-excluding dynamic facet counts, URL-driven desktop UX và mobile draft preview.

**Architecture:** API giữ product list bằng Prisma, bổ sung registry facet dùng chung cho validation/query và một aggregate SQL repository cô lập cho toàn bộ counts. Web lấy catalog ổn định, list và facets qua OpenAPI-generated types; desktop cập nhật URL ngay, còn mobile quản lý draft và gọi preview có debounce.

**Tech Stack:** Express 5, TypeScript, Zod 3, Prisma 6, MySQL, Jest/Supertest, Next.js 16, React 19, TanStack Query 5, Radix UI, SCSS, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-advanced-product-facets-design.md`

## Global Constraints

- Đọc `CLAUDE.md` và `AGENTS.md` của từng repo trước khi sửa; API và web là hai Git repository riêng và phải có commit riêng.
- Không làm trực tiếp trên `main`; implementation branch API phải giữ commit spec `94f7850`, web dùng branch `codex/advanced-product-facets` hoặc worktree tương đương.
- Không push, deploy, đọc production `.env` hoặc chạy backfill trên database thật nếu chưa có phê duyệt riêng.
- API không đọc `process.env` ngoài `src/config/env.ts`, không dùng `console`, dùng bare path aliases, `AppError` code ổn định và mapper cho Product DTO.
- Mọi thay đổi `/api/v1` phải cập nhật `src/docs/openapi.ts` và `tests/docs/openapi.test.ts`; web chỉ cập nhật `schema.d.ts` bằng `npm run gen:api`.
- Không thêm Elasticsearch, EAV, JSON specifications, Redis facet cache hoặc dependency UI/query mới.
- Migration chỉ được tạo/kiểm chứng với `mysql-test`; không dùng `prisma migrate reset` hoặc `prisma db push` trên database thật.
- `/products/filters` dùng `revalidate: 3600`; `/products` và `/products/facets` dùng `cache: "no-store"`; mobile preview dùng `staleTime: 5_000`.
- Filter URL dùng OR trong nhóm, AND giữa nhóm; facet counts luôn self-excluding; selected option không bị disabled dù count bằng 0.
- `panelType` được phép `NULL`; không suy đoán panel hoặc GPU type mơ hồ.
- Mỗi task bắt đầu bằng failing test, kết thúc bằng targeted verification và một commit nhỏ; không gộp commit giữa hai repo.

## Review Focus

1. CSV lặp/rỗng/quá dài và numeric ngoài miền phải bị normalize hoặc từ chối mà không làm SQL shape tăng vô hạn — pin bằng `products.schema.test.ts` trong Task 1.
2. Partial admin patch phải phân biệt omitted với explicit clear để không giữ normalized fields cũ hoặc xóa field không liên quan — pin bằng `admin-products.routes.test.ts` trong Task 2.
3. `q`, `NULL`, hidden/out-of-stock rows và selected value hiện có count 0 phải cho total/count đúng — pin bằng MySQL integration tests trong Task 5.
4. Mobile request bị supersede, facets lỗi hoặc total bằng 0 không được commit draft sai hay khóa người dùng vô lý — pin bằng `FilterSheet.test.tsx` trong Task 10.
5. List/facet cache, Back/Forward và URL có query phải giữ freshness/navigation/SEO contract — pin bằng server/metadata tests trong Task 11 và Playwright trong Task 12.

---

## File Structure

### API repository: `/Users/dinhduy/Workspace/nodejs/laptopshop-api`

**Create**

- `src/modules/products/products.facets.ts` — facet keys, values, labels, modes, option order and safe registry metadata.
- `src/modules/products/products.normalization.ts` — pure CPU/GPU/resolution inference and normalized spec state invariants.
- `src/modules/products/products.filter.ts` — shared Prisma `where` builder with `excludeFacet` support.
- `src/modules/products/products.facets.repository.ts` — the only raw aggregate SQL boundary.
- `src/modules/products/products.facets.service.ts` — normalize aggregate rows, fill static zero options and return the public response.
- `src/scripts/audit-product-facets.ts` — dry-run/apply audit and safe backfill command.
- `prisma/migrations/20261020220000_add_product_facets/migration.sql` — nullable normalized Product columns.
- `tests/modules/products/products.schema.test.ts` — parser limits and taxonomy validation.
- `tests/modules/products/products.normalization.test.ts` — inference and patch invariants.
- `tests/modules/products/products.filter.test.ts` — OR/AND, buckets, thresholds and admin interactions.
- `tests/scripts/audit-product-facets.test.ts` — audit classification and null-only updates.
- `tests/integration/product-facets.int.test.ts` — real-MySQL aggregate contract.

**Modify**

- `prisma/schema.prisma`
- `package.json`
- `src/modules/products/products.schema.ts`
- `src/modules/products/products.service.ts`
- `src/config/seed-products.ts`
- `src/modules/products/products.controller.ts`
- `src/modules/products/products.routes.ts`
- `src/docs/openapi.ts`
- `tests/modules/products/products.routes.test.ts`
- `tests/modules/products/admin-products.routes.test.ts`
- `tests/config/seed.test.ts`
- `tests/docs/openapi.test.ts`

### Web repository: `/Users/dinhduy/Workspace/nodejs/laptopshop-web`

**Create**

- `src/features/products/FilterControls/FilterControls.tsx` and `.module.scss` — controlled renderer for all facet modes.
- `src/features/products/FilterControls/FilterGroup.tsx` — semantic collapsible fieldset/details group.
- `src/features/products/DesktopFilters/DesktopFilters.tsx` — immediate URL adapter.
- `src/features/products/useProductFacetPreview.ts` — debounced, abortable mobile preview query.
- `src/features/products/metadata.ts` — pure products-page robots/canonical policy.
- `tests/features/FilterControls.test.tsx`
- `tests/features/DesktopFilters.test.tsx`
- `tests/features/FilterSheet.test.tsx`
- `tests/features/products-metadata.test.ts`
- `tests/lib/server-api.test.ts`

**Modify**

- `src/lib/api/schema.d.ts`
- `src/lib/api/types.ts`
- `src/lib/api/query-keys.ts`
- `src/lib/api/server.ts`
- `src/lib/api/errors.ts`
- `src/features/products/server.ts`
- `src/features/products/search-params.ts`
- `src/features/products/labels.ts`
- `src/features/products/FilterSheet/FilterSheet.tsx` and `.module.scss`
- `src/features/products/ActiveFilterChips/ActiveFilterChips.tsx`
- `src/features/products/ActiveFilterChips/ActiveFilterChips.module.scss`
- `src/features/admin/products/ProductForm.tsx`
- `tests/features/search-params.test.ts`
- `tests/features/admin/ProductForm.test.tsx`
- `src/app/(storefront)/products/page.tsx`
- `src/app/(storefront)/products/page.module.scss`
- `e2e/storefront.spec.ts`

**Delete after callers migrate**

- `src/features/products/Filters/Filters.tsx`
- `src/features/products/Filters/Filters.module.scss`
- `tests/features/Filters.test.tsx`

---

### Task 1: Define facet taxonomy and validate every query shape

**Files:**
- Create: `src/modules/products/products.facets.ts`
- Create: `tests/modules/products/products.schema.test.ts`
- Modify: `src/modules/products/products.schema.ts`
- Modify: `tests/modules/products/products.routes.test.ts`

**Interfaces:**
- Produces: `ProductFacetKey`, `FacetDefinition`, `facetDefinitions`, `publicFacetDefinitions`, `productFilterFields`, `productFacetsQuery`, and `ProductFilterQuery`.
- Produces query fields: `factory`, `target`, `price`, `cpuBrand`, `gpuBrand`, `gpuType`, `ramGb`, `storageGb`, `screenSize`, `resolutionTier`, `panelType`, `minRefreshHz`, `minBatteryWh`, `maxWeightGrams`, `minWarrantyMonths`, `inStock`, and `q`.
- Later tasks consume the exact keys and option ordering defined here.

- [ ] **Step 1: Write failing schema tests for normalization and limits**

Add tests named:

```ts
it("deduplicates CSV filters and parses exact numeric values", () => {
  expect(productFacetsQuery.parse({ cpuBrand: "INTEL,INTEL,AMD", ramGb: "8,16,16" }))
    .toMatchObject({ cpuBrand: ["INTEL", "AMD"], ramGb: [8, 16] });
});

it("rejects more than ten unique exact numeric values", () => {
  expect(() => productFacetsQuery.parse({ ramGb: "1,2,3,4,5,6,7,8,9,10,11" })).toThrow();
});

it("rejects unknown categorical and out-of-range threshold values", () => {
  expect(() => productFacetsQuery.parse({ cpuBrand: "UNKNOWN" })).toThrow();
  expect(() => productFacetsQuery.parse({ maxWeightGrams: "299" })).toThrow();
});
```

Also pin empty CSV to `[]`, repeated query-array input to `400` through the existing route validation behavior, and `inStock=false` to the no-filter semantic consumed later.

- [ ] **Step 2: Run the schema tests and confirm RED**

Run: `npx jest tests/modules/products/products.schema.test.ts --runInBand`

Expected: FAIL because `productFacetsQuery` and facet registry exports do not exist.

- [ ] **Step 3: Implement the registry and shared Zod shape**

Define these fixed option sets:

- CPU: `INTEL`, `AMD`, `APPLE`, `QUALCOMM`.
- GPU: `NVIDIA`, `AMD`, `INTEL`, `APPLE`, `QUALCOMM`.
- GPU type: `INTEGRATED`, `DEDICATED`.
- Resolution: `HD`, `FHD`, `QHD`, `UHD`.
- Panel: `IPS`, `OLED`, `MINI_LED`, `TN`, `VA`.
- Screen buckets: `compact`, `standard`, `large`.
- Refresh minimums: `60`, `90`, `120`, `144`, `165`, `240`.
- Battery minimums: `40`, `50`, `60`, `80`.
- Weight maximums: `1200`, `1500`, `2000`, `2500`, `3000`.
- Warranty minimums: `12`, `24`, `36`.

Keep current price keys, but change their predicates to non-overlapping boundaries from the spec. Use a reusable CSV helper that deduplicates before applying `maxItems`; exact numeric lists accept integers in the existing Product field ranges and at most ten unique values.

- [ ] **Step 4: Compose list/admin/export schemas from `productFilterFields`**

`listProductsQuery` must add pagination and sort, `productFacetsQuery` must exclude them, and `adminListProductsQuery`/`adminExportProductsQuery` must preserve `isActive` and `stock` behavior.

- [ ] **Step 5: Run targeted schema and existing product route tests**

Run: `npx jest tests/modules/products/products.schema.test.ts tests/modules/products/products.routes.test.ts tests/modules/products/admin-products.routes.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit the taxonomy slice**

```bash
git add src/modules/products/products.facets.ts src/modules/products/products.schema.ts tests/modules/products/products.schema.test.ts tests/modules/products/products.routes.test.ts
git commit -m "feat: define product facet taxonomy"
```

### Task 2: Add normalized Product fields and protect partial-update invariants

**Files:**
- Create: `src/modules/products/products.normalization.ts`
- Create: `tests/modules/products/products.normalization.test.ts`
- Create: `prisma/migrations/20261020220000_add_product_facets/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/products/products.schema.ts`
- Modify: `src/modules/products/products.service.ts`
- Modify: `src/config/seed-products.ts`
- Modify: `tests/modules/products/admin-products.routes.test.ts`
- Modify: `tests/config/seed.test.ts`

**Interfaces:**
- Produces: `CpuBrand`, `GpuBrand`, `GpuType`, `ResolutionTier`, `PanelType` value types from Task 1 constants.
- `assertProductSpecState` throws `AppError` with code `INVALID_PRODUCT_SPECS` and status 400.

```ts
type ProductSpecState = {
  cpu: string | null;
  cpuBrand: CpuBrand | null;
  gpu: string | null;
  gpuBrand: GpuBrand | null;
  gpuType: GpuType | null;
  screenResolution: string | null;
  resolutionTier: ResolutionTier | null;
  panelType: PanelType | null;
};
type ProductSpecPatch = Partial<ProductSpecState>;

inferCpuBrand(text: string | null | undefined): CpuBrand | null;
inferGpuProfile(text: string | null | undefined): { gpuBrand: GpuBrand; gpuType: GpuType } | null;
inferResolutionTier(text: string | null | undefined): ResolutionTier | null;
mergeProductSpecState(current: ProductSpecState, patch: ProductSpecPatch): ProductSpecState;
assertProductSpecState(state: ProductSpecState): void;
```

- [ ] **Step 1: Write failing pure normalization tests**

Pin these exact outcomes:

```ts
expect(inferCpuBrand("AMD Ryzen 7 7840U")).toBe("AMD");
expect(inferGpuProfile("NVIDIA GeForce RTX 4050 6GB"))
  .toEqual({ gpuBrand: "NVIDIA", gpuType: "DEDICATED" });
expect(inferGpuProfile("AMD Radeon Graphics")).toBeNull();
expect(inferResolutionTier(" 2560 × 1600 ")).toBe("QHD");
expect(inferResolutionTier("marketing text")).toBeNull();
```

Add merge tests proving: clearing `gpu` also clears `gpuBrand`/`gpuType`; a price-only patch preserves every spec; changing `screenResolution` recalculates `resolutionTier`; clearing resolution clears tier.

Extend `tests/config/seed.test.ts` with a failing assertion that every seeded CPU/resolution and every unambiguous seeded GPU carries normalized values matching the inference helpers; do not add guessed `panelType` values.

- [ ] **Step 2: Run normalization tests and confirm RED**

Run: `npx jest tests/modules/products/products.normalization.test.ts --runInBand`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalization and state validation**

Use word-boundary/anchored patterns only. Do not classify ambiguous Radeon models or panel type. `resolutionTier` is server-derived and must not be accepted from Product create/patch bodies.

- [ ] **Step 4: Add nullable columns and generate Prisma client**

Create `prisma/migrations/20261020220000_add_product_facets/migration.sql` with one `ALTER TABLE products` adding `cpuBrand`, `gpuBrand`, `gpuType`, `resolutionTier`, and `panelType` as nullable `VARCHAR(20)` columns; do not add speculative indexes. Start and migrate only the throwaway database:

```bash
docker compose --profile test up -d mysql-test
DATABASE_URL=mysql://root:test@127.0.0.1:3307/laptopshop_test npx prisma migrate deploy
npx prisma generate
```

Expected: generated client includes all five Product fields.

- [ ] **Step 5: Write failing admin route tests for normalized writes**

Add assertions that:

- create with `cpu` but no `cpuBrand` returns `400 INVALID_PRODUCT_SPECS` without `product.create`;
- create with `screenResolution=2560x1600` writes `resolutionTier: "QHD"`;
- clearing `gpu` writes `gpu`, `gpuBrand`, and `gpuType` as `null`;
- updating only `price` does not read/overwrite Product specs;
- changing GPU text while preserving an existing normalized profile reads current Product, merges it, then updates atomically from the service perspective.

- [ ] **Step 6: Run admin tests and confirm RED**

Run: `npx jest tests/modules/products/admin-products.routes.test.ts --runInBand`

Expected: FAIL on missing fields/invariants.

- [ ] **Step 7: Wire normalized fields into product create/update**

Extend body schemas with CPU/GPU/panel normalized fields. For PATCH, fetch current Product only when any spec field is present, merge omitted versus explicit-null fields, validate the resulting state, and write one normalized data object. Price-only and visibility-only PATCH paths remain a single update without an extra Product read.

Add safe normalized CPU/GPU/resolution values to `productSeeds`; leave panel absent until verified. Fresh databases must receive the same safe normalization as the backfill path instead of requiring an immediate apply run.

- [ ] **Step 8: Run normalization, admin, mapper and type checks**

Run: `npx jest tests/modules/products/products.normalization.test.ts tests/modules/products/admin-products.routes.test.ts tests/config/seed.test.ts --runInBand && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the normalized data slice**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/products/products.normalization.ts src/modules/products/products.schema.ts src/modules/products/products.service.ts src/config/seed-products.ts tests/modules/products/products.normalization.test.ts tests/modules/products/admin-products.routes.test.ts tests/config/seed.test.ts
git commit -m "feat: normalize product facet attributes"
```

### Task 3: Build a dry-run-first audit and backfill command

**Files:**
- Create: `src/scripts/audit-product-facets.ts`
- Create: `tests/scripts/audit-product-facets.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: inference helpers from Task 2.
- CLI: `npm run products:audit-facets` is dry-run; append `-- --apply` for explicit writes.

```ts
buildFacetBackfillDecision(product: Product): FacetBackfillDecision;
runProductFacetAudit(options: { apply: boolean }): Promise<FacetAuditSummary>;
```

- [ ] **Step 1: Write failing decision tests**

Cover the priority `invalid_resolution > ambiguous > safe_to_update > unverified_panel > already_complete`. Assert a safe decision contains updates only for currently `NULL` fields, ambiguous Radeon does not set `gpuType`, invalid resolution never sets a tier, and missing panel is reported but never inferred.

- [ ] **Step 2: Run audit tests and confirm RED**

Run: `npx jest tests/scripts/audit-product-facets.test.ts --runInBand`

Expected: FAIL because the audit module does not exist.

- [ ] **Step 3: Implement the import-safe audit module and CLI**

The module must not execute on import. Use Prisma and `lib/logger.ts`; inspect `process.argv` only for `--apply`. Apply mode uses conditional `updateMany` predicates that require each target field still be `NULL`, so a concurrent Admin edit is not overwritten.

- [ ] **Step 4: Add the package script**

Add:

```json
"products:audit-facets": "ts-node -r tsconfig-paths/register src/scripts/audit-product-facets.ts"
```

- [ ] **Step 5: Run a safe dry-run against `mysql-test`**

Run:

```bash
NODE_ENV=test DATABASE_URL=mysql://root:test@127.0.0.1:3307/laptopshop_test JWT_SECRET=test-jwt-secret-0123456789 npm run products:audit-facets
```

Expected: exit 0, structured summary, and no database writes.

- [ ] **Step 6: Run audit tests and typecheck**

Run: `npx jest tests/scripts/audit-product-facets.test.ts --runInBand && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the audit command**

```bash
git add package.json src/scripts/audit-product-facets.ts tests/scripts/audit-product-facets.test.ts
git commit -m "feat: audit product facet data"
```

### Task 4: Refactor product filtering into one reusable query builder

**Files:**
- Create: `src/modules/products/products.filter.ts`
- Create: `tests/modules/products/products.filter.test.ts`
- Modify: `src/modules/products/products.service.ts`
- Modify: `tests/modules/products/products.routes.test.ts`
- Modify: `tests/modules/products/admin-products.routes.test.ts`

**Interfaces:**
- Consumes: `ProductFilterQuery`, `ProductFacetKey`, price/screen predicates from Task 1.
- Produces:

```ts
productWhere(
  query: ProductFilterQuery & Partial<Pick<AdminListProductsQuery, "isActive" | "stock">>,
  options: { admin: boolean; excludeFacet?: ProductFacetKey },
): Prisma.ProductWhereInput;
```

- [ ] **Step 1: Write failing pure builder tests**

Assert:

- `factory=ASUS,DELL` becomes one OR-equivalent group and combines with CPU/RAM using AND;
- price `10-15m,15-20m` uses non-overlapping conditions;
- `excludeFacet: "cpuBrand"` removes CPU only while retaining `isActive`, `q`, RAM and stock;
- `stock=low` plus `inStock=true` becomes `quantity <= 5 AND quantity > 0`, not one overwritten object;
- nullable fields are not given special fallback matches.

- [ ] **Step 2: Run builder tests and confirm RED**

Run: `npx jest tests/modules/products/products.filter.test.ts --runInBand`

Expected: FAIL because `products.filter.ts` does not exist.

- [ ] **Step 3: Implement the condition-array builder**

Build one trusted condition per facet and put active conditions in `AND`; keep public/admin base conditions separate. `inStock=false` adds no condition. Do not duplicate filter semantics in `products.service.ts`.

- [ ] **Step 4: Use the builder from list and CSV export and stabilize sort**

Price sort becomes `[{ price: direction }, { id: "asc" }]`; default is `[{ id: "asc" }]`. Update route assertions accordingly.

- [ ] **Step 5: Run product unit/route suites**

Run: `npx jest tests/modules/products/products.filter.test.ts tests/modules/products/products.routes.test.ts tests/modules/products/admin-products.routes.test.ts --runInBand`

Expected: PASS, including pre-existing public/admin/export semantics.

- [ ] **Step 6: Commit**

```bash
git add src/modules/products/products.filter.ts src/modules/products/products.service.ts tests/modules/products/products.filter.test.ts tests/modules/products/products.routes.test.ts tests/modules/products/admin-products.routes.test.ts
git commit -m "refactor: centralize product filter queries"
```

### Task 5: Implement the one-statement self-excluding facet engine

**Files:**
- Create: `src/modules/products/products.facets.repository.ts`
- Create: `src/modules/products/products.facets.service.ts`
- Create: `tests/integration/product-facets.int.test.ts`

**Interfaces:**
- Consumes: `ProductFilterQuery`, registry order/predicates and normalized Product columns.
- Produces:

```ts
type FacetAggregateRow = { facetKey: string; value: string; count: bigint };
type FacetCount = { value: string; count: number };
type ProductFacetsResult = {
  total: number;
  groups: Partial<Record<ProductFacetKey, FacetCount[]>>;
};

queryProductFacetRows(query: ProductFilterQuery): Promise<FacetAggregateRow[]>;
getProductFacets(query: ProductFilterQuery): Promise<ProductFacetsResult>;
```

- [ ] **Step 1: Write a real-MySQL fixture and failing self-exclusion test**

Seed active rows so RAM 16 exists for Intel and AMD, plus an Intel RAM 32 row. With filters `cpuBrand=INTEL&ramGb=16`, assert:

- `total` counts only Intel + 16 GB;
- CPU counts ignore CPU selection and include AMD + 16 GB;
- RAM counts ignore RAM selection and include Intel 16 and Intel 32;
- all other groups retain both active filters.

- [ ] **Step 2: Add failing integration cases for the Review Focus risks**

Add cases for:

- `q` containing an apostrophe is parameterized and does not alter SQL structure;
- hidden rows never count;
- out-of-stock rows disappear only with `inStock=true`;
- `NULL` normalized fields remain in total when that facet is inactive and disappear when selected;
- selected exact value absent from current data is returned with count 0;
- price/screen boundary values belong to exactly one bucket.

- [ ] **Step 3: Run the integration file and confirm RED**

Run: `npx jest -c jest.int.config.ts --runInBand tests/integration/product-facets.int.test.ts`

Expected: FAIL because facet repository/service do not exist.

- [ ] **Step 4: Implement one parameterized aggregate statement**

Use a CTE or derived table to calculate per-group match flags after `isActive` and `q`. Return total plus categorical/exact group rows and conditional bucket/threshold sums through one `$queryRaw` call. All identifiers/operators come from the registry; all request values are bound with `Prisma.sql`/`Prisma.join`.

- [ ] **Step 5: Normalize aggregate rows in the service**

Convert `bigint` to safe JS numbers, preserve registry order, fill static zero-count options, append data-driven RAM/storage values numerically, and retain selected exact values with count 0.

- [ ] **Step 6: Run integration tests and typecheck**

Run: `npx jest -c jest.int.config.ts --runInBand tests/integration/product-facets.int.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/products/products.facets.repository.ts src/modules/products/products.facets.service.ts tests/integration/product-facets.int.test.ts
git commit -m "feat: calculate dynamic product facets"
```

### Task 6: Publish the facet API and OpenAPI contract

**Files:**
- Modify: `src/modules/products/products.controller.ts`
- Modify: `src/modules/products/products.routes.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `tests/modules/products/products.routes.test.ts`
- Modify: `tests/docs/openapi.test.ts`

**Interfaces:**
- Consumes: `productFacetsQuery`, `publicFacetDefinitions`, and `getProductFacets`.
- Produces: public `GET /api/v1/products/facets`, additive `/products/filters` response, normalized Product DTO schema and frontend-generated contract.

- [ ] **Step 1: Write failing route and contract tests**

Assert `/products/facets` is public, appears in the exact path list, is registered above `/:id`, validates unknown values, calls the facet service with parsed arrays/numbers, and returns `{ data: { total, groups } }`. Assert `/products/filters` still contains `factoryOptions`/`targetOptions` and now contains definitions for every facet key. Assert Product OpenAPI includes all five normalized fields.

- [ ] **Step 2: Run route/OpenAPI tests and confirm RED**

Run: `npx jest tests/modules/products/products.routes.test.ts tests/docs/openapi.test.ts --runInBand`

Expected: FAIL on missing route/schema.

- [ ] **Step 3: Add handler, route and additive catalog response**

Implement `getProductFacetsHandler`; keep `/filters`, `/facets`, and `/compare` above `/:id`. Do not expose predicate functions or internal SQL metadata in `facetDefinitions`.

- [ ] **Step 4: Register OpenAPI query and response schemas**

Reuse Zod schemas from the module. Keep old fields required in filter catalog, add named schemas for definitions/facet response, and document `400` on both list and facets.

- [ ] **Step 5: Run the complete API quality gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:int
npm run build
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the public contract**

```bash
git add src/modules/products/products.controller.ts src/modules/products/products.routes.ts src/docs/openapi.ts tests/modules/products/products.routes.test.ts tests/docs/openapi.test.ts
git commit -m "feat: expose product facet API"
```

### Task 7: Regenerate web types and extend Admin Product Form

**Files:**
- Modify: `src/lib/api/schema.d.ts`
- Modify: `src/lib/api/types.ts`
- Modify: `src/lib/api/errors.ts`
- Modify: `src/features/admin/products/ProductForm.tsx`
- Modify: `tests/features/admin/ProductForm.test.tsx`

**Interfaces:**
- Consumes: live OpenAPI document from Task 6.
- Produces: `ProductFacetsQuery`, `ProductFacets`, `FacetDefinition` aliases and Admin multipart fields `cpuBrand`, `gpuBrand`, `gpuType`, `panelType`. `ProductFacets` is the response `data` object, not the outer `{ data }` envelope.

- [ ] **Step 1: Regenerate API types from the running API**

Run the API locally with docs enabled, then in web:

```bash
OPENAPI_URL=http://localhost:8080/api-docs.json npm run gen:api
```

Expected: generated schema contains `/api/v1/products/facets`, additive catalog and normalized Product fields. Do not hand-edit `schema.d.ts`.

- [ ] **Step 2: Write failing Admin Form tests**

Extend fixtures with normalized fields and catalog definitions. Assert:

- CPU/GPU/panel selects render the generated options;
- selecting a CPU/GPU profile sends all normalized multipart fields;
- clearing GPU sends blank `gpu`, `gpuBrand`, and `gpuType`;
- resolution tier is displayed read-only from Product data;
- `INVALID_PRODUCT_SPECS` maps to the Vietnamese message `Thông số kỹ thuật không nhất quán.`; ordinary Zod field errors continue through `setServerErrors`.

- [ ] **Step 3: Run the Admin Form test and confirm RED**

Run: `npm test -- tests/features/admin/ProductForm.test.tsx`

Expected: FAIL on missing fields/options.

- [ ] **Step 4: Implement typed aliases and form controls**

Extract options from `facetDefinitions` by key. Add normalized keys to `ProductFormValues` and `toProductFormData`; keep explicit blank semantics. Use Ant Design conditional rules so visible client validation matches server invariants without treating `panelType` as required.

- [ ] **Step 5: Run Admin tests, lint and typecheck**

Run: `npm test -- tests/features/admin/ProductForm.test.tsx && npm run lint && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit in the web repo**

```bash
git add src/lib/api/schema.d.ts src/lib/api/types.ts src/lib/api/errors.ts src/features/admin/products/ProductForm.tsx tests/features/admin/ProductForm.test.tsx
git commit -m "feat: edit normalized product facets"
```

### Task 8: Expand the web URL model and typed facet data clients

**Files:**
- Modify: `src/features/products/search-params.ts`
- Modify: `src/features/products/labels.ts`
- Modify: `src/features/products/server.ts`
- Modify: `src/lib/api/query-keys.ts`
- Modify: `tests/features/search-params.test.ts`

**Interfaces:**
- Threshold/scalar values use `undefined` for inactive state; multi-select values are arrays; `page` always exists.

```ts
parseFilters(raw: RawSearchParams, catalog: FilterOptions): ProductFilters;
toQueryString(filters: ProductFilters): string;
toApiQuery(filters: ProductFilters): ProductQuery;
toFacetsApiQuery(filters: ProductFilters): ProductFacetsQuery;
activeFilterCount(filters: ProductFilters): number;
getProductFacets(query: ProductFacetsQuery): Promise<ProductFacets>;
```

- [ ] **Step 1: Write failing URL round-trip tests**

Test one canonical object containing every filter type. Assert parse drops invalid enum/numeric values, deduplicates arrays, serializes keys in the declared order, omits defaults/false/page 1, preserves `q`/sort, and both API query helpers return generated-type-compatible objects. Include RAM `24` and storage `1000` to prove exact numeric facets are data-driven.

- [ ] **Step 2: Run search-param tests and confirm RED**

Run: `npm test -- tests/features/search-params.test.ts`

Expected: FAIL because advanced fields/helpers are absent.

- [ ] **Step 3: Implement the centralized key tables and formatters**

Use typed `MULTI_FILTER_KEYS` and scalar descriptors. `activeFilterCount` counts each selected multi value and each active scalar/toggle once. Clearing filters preserves `q` and sort only where existing UX requires it.

- [ ] **Step 4: Add typed server accessors and query key**

`getProductFacets(query)` returns the response data. Add `queryKeys.productFacets(canonicalQuery)`. Do not introduce client preview behavior yet.

- [ ] **Step 5: Run search-param tests and typecheck**

Run: `npm test -- tests/features/search-params.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/products/search-params.ts src/features/products/labels.ts src/features/products/server.ts src/lib/api/query-keys.ts tests/features/search-params.test.ts
git commit -m "feat: model advanced product filters in URLs"
```

### Task 9: Build controlled filter groups, desktop navigation and complete chips

**Files:**
- Create: `src/features/products/FilterControls/FilterControls.tsx`
- Create: `src/features/products/FilterControls/FilterControls.module.scss`
- Create: `src/features/products/FilterControls/FilterGroup.tsx`
- Create: `src/features/products/DesktopFilters/DesktopFilters.tsx`
- Create: `tests/features/FilterControls.test.tsx`
- Create: `tests/features/DesktopFilters.test.tsx`
- Modify: `src/features/products/ActiveFilterChips/ActiveFilterChips.tsx`
- Delete: `src/features/products/Filters/Filters.tsx`
- Delete: `src/features/products/Filters/Filters.module.scss`
- Delete: `tests/features/Filters.test.tsx`

**Interfaces:**
- `FilterControls` props: `{ definitions, counts, filters, onChange, idPrefix, busy?, countsAvailable? }`.
- `DesktopFilters` receives the same catalog/count/filter data and owns immediate `router.push` behavior.
- Counts are view data only; selected state always comes from `ProductFilters`.

- [ ] **Step 1: Write failing controlled-control tests**

Assert all modes render correctly, `Intel (0)` is disabled when unselected, selected `Intel (0)` remains enabled and can emit a removal, numeric exact labels include units, and `countsAvailable=false` removes disabled state/count claims. Check `<details>/<summary>`, fieldset/legend and unique IDs for desktop/sheet prefixes.

- [ ] **Step 2: Run controls tests and confirm RED**

Run: `npm test -- tests/features/FilterControls.test.tsx`

Expected: FAIL because controls do not exist.

- [ ] **Step 3: Implement controlled groups without router or fetching**

Use native details/summary and existing Checkbox/Button primitives. Keep important groups open by default and advanced groups collapsed. Ensure each interactive row has at least a 44px target through SCSS.

- [ ] **Step 4: Write failing desktop and chip tests**

Create `tests/features/DesktopFilters.test.tsx`. Assert desktop changes one group, preserves every other field and resets page 3 to 1. Assert chips remove multi values, thresholds and `inStock`, and clear-all preserves `q`/sort while clearing all facet fields.

- [ ] **Step 5: Implement `DesktopFilters` and complete chips**

Replace every `Filters` caller with `DesktopFilters` or `FilterControls`, then delete the old `Filters` component/styles/test. Do not keep two independent filter renderers.

- [ ] **Step 6: Run component suites and accessibility-oriented assertions**

Run: `npm test -- tests/features/FilterControls.test.tsx tests/features/DesktopFilters.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/features/products/FilterControls src/features/products/DesktopFilters src/features/products/Filters src/features/products/ActiveFilterChips tests/features/FilterControls.test.tsx tests/features/DesktopFilters.test.tsx tests/features/Filters.test.tsx
git commit -m "feat: render dynamic product filter controls"
```

### Task 10: Add debounced mobile draft preview and resilient apply behavior

**Files:**
- Create: `src/features/products/useProductFacetPreview.ts`
- Create: `tests/features/FilterSheet.test.tsx`
- Modify: `src/features/products/FilterSheet/FilterSheet.tsx`
- Modify: `src/features/products/FilterSheet/FilterSheet.module.scss`

**Interfaces:**
- Produces:

```ts
useProductFacetPreview(
  filters: ProductFilters,
  enabled: boolean,
  initialData?: ProductFacets,
): UseQueryResult<ProductFacets>;
```

- Uses `toFacetsApiQuery`, `queryKeys.productFacets`, browser `api.GET`, a 300ms debounce and TanStack Query `signal`.

- [ ] **Step 1: Write failing mobile interaction tests with fake timers**

Assert opening copies applied filters; draft clicks do not call router; one preview request fires after 300ms; a second edit supersedes/aborts the first query; Apply pushes once and closes; close/reopen discards unapplied draft; successful total 0 disables Apply; preview error removes count-derived disables and leaves Apply enabled.

- [ ] **Step 2: Run the sheet test and confirm RED**

Run: `npm test -- tests/features/FilterSheet.test.tsx`

Expected: FAIL because draft hook/behavior do not exist.

- [ ] **Step 3: Implement the preview hook**

Keep debounce inside the hook or a private helper, pass the TanStack Query abort signal to openapi-fetch, use `staleTime: 5_000`, and enable only while the sheet is open. Do not retry client validation errors.

- [ ] **Step 4: Implement controlled sheet state and sticky footer**

On open, reset draft from applied props and seed preview with server facets. Render `Xem N sản phẩm`, reset and apply actions. Error text must be non-blocking and accessible; no `console` logging.

- [ ] **Step 5: Run sheet tests, lint and CSS lint**

Run: `npm test -- tests/features/FilterSheet.test.tsx && npm run lint && npm run lint:css`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/products/useProductFacetPreview.ts src/features/products/FilterSheet tests/features/FilterSheet.test.tsx
git commit -m "feat: preview mobile product facets"
```

### Task 11: Integrate page loading, cache policy, degraded facets and SEO

**Files:**
- Create: `src/features/products/metadata.ts`
- Create: `tests/features/products-metadata.test.ts`
- Create: `tests/lib/server-api.test.ts`
- Modify: `src/lib/api/server.ts`
- Modify: `src/features/products/server.ts`
- Modify: `src/app/(storefront)/products/page.tsx`
- Modify: `src/app/(storefront)/products/page.module.scss`

**Interfaces:**
- Produces separate server clients/fetch adapters for catalog (`revalidate: 3600`) and fresh data (`cache: "no-store"`).
- Produces `productsMetadata(raw): Metadata` with index only for query-free `/products`.
- Product page passes one normalized filter object and one server facet result to both desktop and mobile components.

- [ ] **Step 1: Write failing cache adapter tests**

Mock global fetch and assert catalog requests receive `{ next: { revalidate: 3600 } }`, while list/facets receive `{ cache: "no-store" }`. Ensure Product detail behavior is explicit rather than accidentally inheriting the wrong client.

- [ ] **Step 2: Write failing metadata tests**

Assert `{}` returns indexable self-canonical metadata. Assert each of `q`, a facet, sort and `page=2` produces `robots: { index: false, follow: true }` and canonical `/products`.

- [ ] **Step 3: Run tests and confirm RED**

Run: `npm test -- tests/lib/server-api.test.ts tests/features/products-metadata.test.ts`

Expected: FAIL on current shared 60-second cache and missing metadata helper.

- [ ] **Step 4: Implement explicit cache clients and metadata helper**

Keep `fetchPublic` response/error behavior unchanged. Do not expose `API_ORIGIN` to browser code.

- [ ] **Step 5: Integrate list and facet loading into ProductsPage**

After catalog-based URL normalization, call list and facets concurrently. Facet failure must resolve to `null` without hiding a successful list; pass `countsAvailable=false` so controls remain usable. List failure still reaches the page error boundary. Display list meta total as the authoritative applied-result count.

- [ ] **Step 6: Run page-adjacent tests, typecheck and build**

Run:

```bash
npm test -- tests/lib/server-api.test.ts tests/features/products-metadata.test.ts tests/features/search-params.test.ts tests/features/FilterControls.test.tsx tests/features/FilterSheet.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/api/server.ts src/features/products/server.ts src/features/products/metadata.ts src/app/'(storefront)'/products tests/lib/server-api.test.ts tests/features/products-metadata.test.ts
git commit -m "feat: integrate dynamic facets into product page"
```

### Task 12: Verify end-to-end behavior, inspect SQL plans and close the branch

**Files:**
- Modify: `e2e/storefront.spec.ts`
- Create local evidence: `docs-local/verification/advanced-product-facets-explain.md` (keep local unless the user asks to track verification evidence).

**Interfaces:**
- Consumes the complete API/web feature.
- Produces executable storefront journeys and final verification evidence; no new product interfaces.

- [ ] **Step 1: Write failing desktop E2E coverage**

Extend the browse test or add a focused test that selects two values in one group and one value in another, verifies OR/AND product results, count labels, URL persistence after reload, chip removal and Back/Forward restoration.

- [ ] **Step 2: Write failing mobile E2E coverage**

At 390px, open the sheet, change draft and prove URL is unchanged; cancel and prove the draft is discarded; reopen, apply and prove one navigation occurs. At 320px, assert no horizontal overflow and sticky actions remain visible.

- [ ] **Step 3: Run the focused storefront E2E suite**

Start API with migrated/seeded `mysql-test` or approved local development database, then run in web: `npm run e2e -- e2e/storefront.spec.ts`

Expected: PASS. If the API is absent, report `ECONNREFUSED` as environment setup, not a frontend regression. If a genuine defect fails the journey, first add the narrowest failing unit/integration regression test in the task that owns the behavior, then implement and commit that focused fix before rerunning E2E.

- [ ] **Step 4: Inspect representative aggregate query plans**

Run `EXPLAIN ANALYZE` for: no filters, one categorical filter, combined CPU+RAM+price, and `inStock=true` with search. Record rows scanned, execution time and whether an index materially improves the plan in `docs-local/verification/advanced-product-facets-explain.md`. Add no index unless the before/after plan demonstrates benefit.

- [ ] **Step 5: Run final API verification from the API repo**

```bash
npm run lint
npm run typecheck
npm test
npm run test:int
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Run final web verification from the web repo**

```bash
npm run lint
npm run lint:css
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit E2E tests in the web repo**

```bash
git add e2e/storefront.spec.ts
git commit -m "test: cover dynamic product facets"
```

- [ ] **Step 8: Review final diffs without integrating or deploying**

Confirm both repositories are clean, list commit SHAs, compare API branch against its base and web branch against its base, and request whole-branch review. Do not merge, push, deploy or run production backfill without explicit authorization.
