# Product Reviews Phase 4D — Catalog Rating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hiển thị rating/count trên catalog `ProductCard`, lọc sản phẩm từ 3/4 sao và sắp xếp rating cao nhất với pagination/facets chính xác.

**Architecture:** Review stats được aggregate trực tiếp từ review công khai. Trang không dùng rating filter/sort lấy product page bằng Prisma rồi aggregate một lần theo page IDs; `minRating`/`rating_desc` dùng parameterized SQL CTE để filter/order/page tại database. Facet repository dùng cùng SQL predicate builder để tránh lệch semantics; không tạo cache hoặc counter trên `Product`.

**Tech Stack:** Express 5, TypeScript, Prisma/MySQL raw parameterized SQL, Zod/OpenAPI, Jest/integration tests, Next.js Server Components, SCSS Modules, Vitest/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-product-reviews-phase-4-design.md`

## Global Constraints

- Stats chỉ dùng review `PUBLISHED AND deletedAt IS NULL`.
- `minRating` chỉ nhận `3 | 4`; bật filter loại product chưa có review.
- `rating_desc`: `averageRating DESC`, `totalReviews DESC`, `productId ASC`; product chưa có review ở cuối.
- Product chưa có review trả `averageRating: null`, `totalReviews: 0`.
- Không N+1; không thêm review counters/cache/materialized table ở Phase 4.
- Raw SQL phải dùng `Prisma.sql`/bound values; không nội suy query string hoặc column tùy ý.
- URL search params là canonical state; mobile/desktop dùng cùng facet definition.
- Product card hiển thị `★ 4.6 (25)` hoặc “Chưa có đánh giá”; không thêm `rating_asc`.

## Review Focus

- Page chỉ gồm product chưa có review khi `rating_desc` vẫn phải có total/pagination đúng và ID ổn định; repository integration test trong Task 3.
- Average tie nhưng review counts khác phải dùng count rồi ID, không phụ thuộc row order; Task 3.
- Hidden/deleted review phải biến mất đồng thời khỏi card, filter, sort và facet counts; Tasks 2–4.
- `minRating` kết hợp search, price, multi-facets và inactive products phải cho list/facets cùng total; Task 4.
- URL có `minRating=5`, duplicate params hoặc sort lạ phải được frontend canonicalize và API reject/drop đúng contract; Tasks 1 và 6.

---

### Task 1: Rating filter/sort schema and facet definition

**Files:**
- Modify: `src/modules/products/products.schema.ts`
- Modify: `src/modules/products/products.facets.ts`
- Test: `tests/modules/products/products.schema.test.ts`
- Test: `tests/modules/products/products.filter.test.ts`

**Interfaces:**
- Produces: `ProductFilterQuery.minRating?: 3 | 4`, `ListProductsQuery.sort?: "price_asc" | "price_desc" | "rating_desc"`, facet key `minRating` with `SINGLE_MIN` options 4 then 3.

- [ ] **Step 1: Add failing schema tests** for 3/4 acceptance, 1/2/5/decimal/repeated invalid values, and `rating_desc` allow-listing.

- [ ] **Step 2: Add failing facet definition tests** asserting Vietnamese labels and a single `minRating` definition shared by filters/facets.

- [ ] **Step 3: Extend types/constants/schema**; keep admin sort behavior explicit so `rating_desc` is accepted only where intended or covered by tests.

- [ ] **Step 4: Run focused tests.**

Run: `npm test -- tests/modules/products/products.schema.test.ts tests/modules/products/products.filter.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/products/products.schema.ts src/modules/products/products.facets.ts tests/modules/products
git commit -m "feat: define catalog rating controls"
```

### Task 2: Shared review-stat aggregates

**Files:**
- Create: `src/modules/products/products.review-stats.repository.ts`
- Modify: `src/modules/products/products.mapper.ts`
- Test: `tests/modules/products/products.review-stats.test.ts`
- Test: `tests/integration/product-review-stats.int.test.ts`

**Interfaces:**
- Produces: `ProductReviewSummary`, `getReviewStatsForProductIds(productIds)` and `toCatalogProductDto(product, summary)`.

- [ ] **Step 1: Add failing unit/integration tests** for empty IDs, products without reviews, average rounded to one decimal, public-only rows and one aggregate query for a page.

- [ ] **Step 2: Implement interfaces.**

```ts
export type ProductReviewSummary = { averageRating: number | null; totalReviews: number };
export const getReviewStatsForProductIds: (productIds: number[]) => Promise<Map<number, ProductReviewSummary>>;
export const emptyProductReviewSummary: ProductReviewSummary;
export const toCatalogProductDto: (product: Product, summary?: ProductReviewSummary) => ProductDto & { reviewSummary: ProductReviewSummary };
```

Use `groupBy productId` with `_avg.rating` and `_count._all`; fill missing IDs with `{ averageRating: null, totalReviews: 0 }` in the service/mapper.

- [ ] **Step 3: Run tests.**

Run: `npm test -- tests/modules/products/products.review-stats.test.ts --runInBand`

Run: `npm run test:int -- tests/integration/product-review-stats.int.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/modules/products/products.review-stats.repository.ts src/modules/products/products.mapper.ts tests/modules/products/products.review-stats.test.ts tests/integration/product-review-stats.int.test.ts
git commit -m "feat: aggregate public product ratings"
```

### Task 3: Rated catalog query and stable pagination

**Files:**
- Create: `src/modules/products/products.catalog-sql.ts`
- Create: `src/modules/products/products.rating.repository.ts`
- Modify: `src/modules/products/products.service.ts`
- Modify: `src/modules/products/products.filter.ts`
- Test: `tests/modules/products/products.rating.repository.test.ts`
- Test: `tests/modules/products/products.routes.test.ts`
- Test: `tests/integration/product-review-stats.int.test.ts`

**Interfaces:**
- Consumes: filter constants/types from Task 1 and summaries from Task 2.
- Produces: parameterized product predicates and `queryRatedProductPage(query)`.

- [ ] **Step 1: Add failing repository tests** proving all user values are bound, unknown sort never reaches SQL and `rating_desc` emits the exact three tie-breakers plus nulls-last behavior.

- [ ] **Step 2: Add failing integration cases** for reviewed/unreviewed page boundaries, equal average/different count, equal average/count/different ID, high out-of-range page, hidden/deleted reviews and inactive products.

- [ ] **Step 3: Extract shared parameterized SQL predicates** from the existing facet repository into `products.catalog-sql.ts`; keep column names from an internal allow-list only.

- [ ] **Step 4: Implement repository signature.**

```ts
export type RatedProductPage = {
  productIds: number[];
  summaries: Map<number, ProductReviewSummary>;
  total: number;
};
export const queryRatedProductPage: (query: ListProductsQuery) => Promise<RatedProductPage>;
```

Use a `review_stats` CTE and left join. Apply `minRating` after the join; use `LIMIT/OFFSET` from validated page args.

- [ ] **Step 5: Update `listProducts`**: preserve the current base-DTO path when `admin=true`; for public price/default sorts attach one batch summary; for public `minRating` or `rating_desc` use the rated repository, fetch product rows by returned IDs and restore repository order.

- [ ] **Step 6: Run focused and integration tests.**

Run: `npm test -- tests/modules/products/products.rating.repository.test.ts tests/modules/products/products.routes.test.ts --runInBand`

Run: `npm run test:int -- tests/integration/product-review-stats.int.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/modules/products tests/modules/products tests/integration/product-review-stats.int.test.ts
git commit -m "feat: filter and sort catalog by rating"
```

### Task 4: Rating-aware facets

**Files:**
- Modify: `src/modules/products/products.facets.repository.ts`
- Modify: `src/modules/products/products.facets.service.ts`
- Test: `tests/integration/product-facets.int.test.ts`
- Test: `tests/modules/products/products.routes.test.ts`

**Interfaces:**
- Consumes: shared SQL predicates from Task 3.
- Produces: `minRating` facet counts and total consistent with catalog list.

- [ ] **Step 1: Add failing integration matrix** combining `minRating` with q, price, factory and another threshold; assert list total equals facet total and self-exclusion semantics show counts for both 4+ and 3+ options.

- [ ] **Step 2: Extend facet base CTE** with `review_stats`; route every existing and rating predicate through the shared SQL helper.

- [ ] **Step 3: Add the `minRating` threshold branch** and ensure products without reviews count as zero only when rating filter is inactive.

- [ ] **Step 4: Run facet/product tests.**

Run: `npm test -- tests/modules/products/products.routes.test.ts --runInBand`

Run: `npm run test:int -- tests/integration/product-facets.int.test.ts tests/integration/product-review-stats.int.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/products/products.facets.repository.ts src/modules/products/products.facets.service.ts tests/modules/products/products.routes.test.ts tests/integration
git commit -m "feat: add rating-aware product facets"
```

### Task 5: Catalog detail DTO and OpenAPI

**Files:**
- Modify: `src/modules/products/products.service.ts`
- Modify: `src/docs/openapi.ts`
- Test: `tests/modules/products/products.routes.test.ts`
- Test: `tests/docs/openapi.test.ts`
- Modify: `../laptopshop-web/src/lib/api/schema.d.ts`
- Modify: `../laptopshop-web/src/lib/api/types.ts`

**Interfaces:**
- Produces OpenAPI `ProductReviewSummary` and `CatalogProduct`; public product list/detail return `CatalogProduct`, while admin/compare/cart/order base `Product` contracts remain unchanged.

- [ ] **Step 1: Add failing route tests** asserting public list and detail always include `reviewSummary`, including null/zero, without changing admin/compare payload requirements.

- [ ] **Step 2: Add failing OpenAPI tests** for `minRating`, `rating_desc`, facet definition and `CatalogProduct` usage on `/products` and `/products/{id}`.

- [ ] **Step 3: Attach a single summary in public `getProduct`** and register distinct Product/CatalogProduct schemas; avoid making reviewSummary mandatory on unrelated nested product contracts.

- [ ] **Step 4: Run API tests and regenerate web client.**

Run: `npm test -- tests/modules/products/products.routes.test.ts tests/docs/openapi.test.ts --runInBand`

Run from `../laptopshop-web`: `npm run gen:api`

Expected: PASS and generated `CatalogProduct` type.

- [ ] **Step 5: Define web types** so `CatalogProduct` is required for `ProductGrid`; retain base `Product` for advisor/compare/cart/order and do not fabricate a zero summary for missing contracts. `ProductCard` may accept a base product but must render rating only when `reviewSummary` is actually present.

- [ ] **Step 6: Commit in each repository.**

```bash
git add src/modules/products/products.service.ts src/docs/openapi.ts tests/modules/products/products.routes.test.ts tests/docs/openapi.test.ts
git commit -m "docs: publish catalog rating contract"
```

```bash
git add src/lib/api
git commit -m "chore: regenerate catalog rating client"
```

### Task 6: Catalog search params, filters, sorting and cards

**Files:**
- Modify: `../laptopshop-web/src/features/products/search-params.ts`
- Modify: `../laptopshop-web/src/features/products/labels.ts`
- Modify: `../laptopshop-web/src/features/products/FilterControls/FilterControls.tsx`
- Modify: `../laptopshop-web/src/features/products/ProductGrid/ProductGrid.tsx`
- Modify: `../laptopshop-web/src/features/products/ProductCard/ProductCard.tsx`
- Modify: `../laptopshop-web/src/features/products/ProductCard/ProductCard.module.scss`
- Modify: `../laptopshop-web/src/features/products/server.ts`
- Test: `../laptopshop-web/tests/features/search-params.test.ts`
- Test: `../laptopshop-web/tests/features/FilterControls.test.tsx`
- Test: `../laptopshop-web/tests/features/ProductCard.test.tsx`
- Test: `../laptopshop-web/tests/features/DesktopFilters.test.tsx`
- Test: `../laptopshop-web/tests/features/FilterSheet.test.tsx`

**Interfaces:**
- Consumes: generated `CatalogProduct`, `minRating`, `rating_desc`, facet definitions.
- Produces canonical URL/query mapping and accessible card rating presentation.

- [ ] **Step 1: Add failing search-param tests** for parsing/serializing 3/4, dropping 5/duplicates, `rating_desc`, stable key order, page reset and facet API propagation.

- [ ] **Step 2: Add failing shared-filter tests** proving desktop and mobile render “Từ 4 sao”/“Từ 3 sao”, single-select behavior and active-chip removal.

- [ ] **Step 3: Add failing ProductCard tests** for `★ 4.6 (25)`, localized accessible label and “Chưa có đánh giá”.

- [ ] **Step 4: Implement types/parsing/labels/filter controls** from the shared `FacetDefinition`; do not branch separate mobile logic.

- [ ] **Step 5: Require `CatalogProduct` in ProductGrid; let ProductCard accept `Product | CatalogProduct`** and render the rating row only when the property is present. Catalog always supplies it; advisor reuse remains unchanged rather than showing a false zero-rating state.

- [ ] **Step 6: Run focused tests and CSS lint.**

Run from `../laptopshop-web`: `npm test -- tests/features/search-params.test.ts tests/features/FilterControls.test.tsx tests/features/ProductCard.test.tsx tests/features/DesktopFilters.test.tsx tests/features/FilterSheet.test.tsx`

Run from `../laptopshop-web`: `npm run lint:css`

Expected: PASS.

- [ ] **Step 7: Commit in the web repository.**

```bash
git add src/features/products tests/features
git commit -m "feat: add catalog rating discovery"
```

### Task 7: Phase 4D E2E, query-plan check and full verification

**Files:**
- Modify: `../laptopshop-web/e2e/storefront.spec.ts`
- Create: `src/scripts/audit-product-rating-query.ts`
- Modify: `package.json`
- Test: `tests/scripts/audit-product-rating-query.test.ts`
- Modify if required by findings: files from Tasks 1–6

**Interfaces:**
- Produces: `npm run products:audit-rating` and a releasable rating catalog flow.

- [ ] **Step 1: Add audit script test** asserting the command runs `EXPLAIN` for `minRating + rating_desc`, rejects non-test/explicitly approved database targets and reports full-scan/temp/filesort fields without mutating data.

- [ ] **Step 2: Implement the read-only audit command** and run it against `mysql-test`; add an index only if measured plan/output shows a justified regression, then pin it with an integration test.

- [ ] **Step 3: Extend Playwright** to seed reviews with ties/hidden rows, assert card summaries, 4+ filter, rating sort, stable page navigation and mobile filter sheet.

- [ ] **Step 4: Run API gates.**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int`

Expected: PASS.

- [ ] **Step 5: Run web gates.**

Run from `../laptopshop-web`: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && npm run e2e`

Expected: PASS.

- [ ] **Step 6: Run `git diff --check` in both repositories** and commit only audit/E2E/verification fixes.

```bash
git commit -am "test: verify catalog rating discovery"
```
