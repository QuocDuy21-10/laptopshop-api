# Product Reviews Phase 4B — Helpful Votes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép người dùng đăng nhập vote/unvote review công khai theo cách idempotent, không tự vote, đồng thời hiển thị count và viewer state chính xác trên storefront.

**Architecture:** `ReviewHelpful` là membership table có composite primary key `(reviewId, userId)`. Public review DTO aggregate `helpfulCount`; viewer state được tải bằng một authenticated batch endpoint riêng để public response không phụ thuộc session/cache.

**Tech Stack:** Express 5, TypeScript, Prisma/MySQL, Zod/OpenAPI, Jest/Supertest, React Query, Next.js/Vitest/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-product-reviews-phase-4-design.md`

## Global Constraints

- Chỉ user đã đăng nhập được vote; tác giả không được vote review của chính mình.
- Chỉ review `PUBLISHED AND deletedAt IS NULL` được vote hoặc xuất hiện trong viewer state.
- `PUT` và `DELETE` phải idempotent; unique constraint bảo vệ duplicate/concurrency.
- Batch endpoint nhận tối đa 50 unique positive review IDs.
- Public DTO chỉ thêm `helpfulCount`; user IDs không được công khai.
- Hidden giữ vote rows nhưng không public count; customer delete xoá votes trong cùng transaction.
- Route/API changes phải cập nhật OpenAPI, tests và generated web client.

## Review Focus

- Hai `PUT` đồng thời của cùng user/review phải tạo đúng một row và cùng hội tụ về một count; integration test trong Task 2.
- Review bị admin ẩn giữa lần list và lần vote phải trả public-not-found behavior, không để lộ trạng thái; route test trong Task 2.
- Batch IDs có duplicate, hơn 50 phần tử hoặc ID không tồn tại phải được normalize/reject nhất quán; schema tests trong Task 2.
- Customer delete phải xoá votes trước khi rewrite để content mới không kế thừa social proof cũ; lifecycle test trong Task 3.
- Optimistic UI lỗi mạng/409 phải rollback count và `aria-pressed`; frontend test trong Task 5.

---

### Task 1: Helpful membership schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261021110000_add_review_helpful/migration.sql`
- Modify: `tests/helpers/prisma.ts`
- Test: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Produces: Prisma `ReviewHelpful`, `Review.helpfulVotes`, `User.reviewHelpfulVotes`.

- [ ] **Step 1: Add failing integration tests** for one membership per `(reviewId, userId)`, multiple users per review and preserved rows across hide/restore.

- [ ] **Step 2: Add the Prisma model and generate an additive migration** against `mysql-test`; inspect composite PK and user index.

- [ ] **Step 3: Run generation and integration tests.**

Run: `npx prisma generate`

Run: `npm run test:int -- tests/integration/reviews.int.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add prisma tests/helpers/prisma.ts tests/integration/reviews.int.test.ts
git commit -m "feat: add review helpful membership"
```

### Task 2: Helpful service, schema and routes

**Files:**
- Create: `src/modules/reviews/review-helpful.service.ts`
- Modify: `src/modules/reviews/reviews.schema.ts`
- Modify: `src/modules/reviews/reviews.controller.ts`
- Modify: `src/modules/reviews/reviews.routes.ts`
- Modify: `src/middlewares/rate-limit.ts`
- Modify: `src/app.ts`
- Modify: `src/server.ts`
- Test: `tests/modules/reviews/review-helpful.routes.test.ts`
- Test: `tests/modules/reviews/reviews.schema.test.ts`
- Test: `tests/integration/review-helpful.int.test.ts`

**Interfaces:**
- Produces: `listMyHelpfulReviewIds`, `markReviewHelpful`, `unmarkReviewHelpful`.

- [ ] **Step 1: Add failing schema/route tests** for authentication, max 50 IDs, duplicate normalization, self-vote, hidden/deleted review, idempotent PUT/DELETE and stable response count.

- [ ] **Step 2: Add failing concurrency integration test** issuing two `markReviewHelpful` calls and asserting one row plus count 1.

- [ ] **Step 3: Implement signatures.**

```ts
export const listMyHelpfulReviewIds: (userId: number, reviewIds: number[]) => Promise<number[]>;
export const markReviewHelpful: (userId: number, reviewId: number) => Promise<{ reviewId: number; helpfulCount: number; helpful: true }>;
export const unmarkReviewHelpful: (userId: number, reviewId: number) => Promise<{ reviewId: number; helpfulCount: number; helpful: false }>;
```

Use unique violation handling for idempotent PUT and a transaction/current visibility check so hidden/deleted reviews cannot receive votes.

- [ ] **Step 4: Register static batch route before `/:id`** and add a dedicated helpful mutation limiter/store prefix without sharing auth/advisor counters.

- [ ] **Step 5: Run focused unit/integration tests.**

Run: `npm test -- tests/modules/reviews/review-helpful.routes.test.ts tests/modules/reviews/reviews.schema.test.ts --runInBand`

Run: `npm run test:int -- tests/integration/review-helpful.int.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/app.ts src/server.ts src/middlewares/rate-limit.ts src/modules/reviews tests/modules/reviews tests/integration/review-helpful.int.test.ts
git commit -m "feat: add helpful review votes"
```

### Task 3: Public count and delete lifecycle

**Files:**
- Modify: `src/modules/reviews/reviews.mapper.ts`
- Modify: `src/modules/reviews/reviews.service.ts`
- Test: `tests/modules/reviews/reviews.mapper.test.ts`
- Test: `tests/modules/reviews/reviews.routes.test.ts`
- Test: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Consumes: `Review.helpfulVotes` relation from Task 1.
- Produces: `PublicReviewDto.helpfulCount` and customer-delete vote cleanup.

- [ ] **Step 1: Add failing mapper/route tests** asserting count appears, user IDs never appear, and hidden/deleted reviews remain excluded.

- [ ] **Step 2: Add failing lifecycle test** asserting customer delete removes all memberships and rewrite returns count 0.

- [ ] **Step 3: Extend public selects with `_count.helpfulVotes`** without issuing per-review queries; refactor customer soft delete into an interactive transaction that updates the review and deletes its votes atomically.

- [ ] **Step 4: Run review suites.**

Run: `npm test -- tests/modules/reviews --runInBand`

Run: `npm run test:int -- tests/integration/reviews.int.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/reviews tests/modules/reviews tests/integration/reviews.int.test.ts
git commit -m "feat: expose helpful review counts"
```

### Task 4: OpenAPI and regenerated web contract

**Files:**
- Modify: `src/docs/openapi.ts`
- Test: `tests/docs/openapi.test.ts`
- Modify: `../laptopshop-web/src/lib/api/schema.d.ts`
- Modify: `../laptopshop-web/src/lib/api/types.ts`
- Modify: `../laptopshop-web/src/lib/api/query-keys.ts`

**Interfaces:**
- Produces generated types for helpful batch and mutations; `PublicReview.helpfulCount: number`.

- [ ] **Step 1: Add failing OpenAPI tests** for all three endpoints, auth/errors, batch query and mutation response.

- [ ] **Step 2: Register schemas/routes and run docs tests.**

Run: `npm test -- tests/docs/openapi.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 3: Start API docs and regenerate web types** with `npm run gen:api`; add `queryKeys.reviewHelpfulState(reviewIds, userId)`.

- [ ] **Step 4: Run web typecheck.**

Run from `../laptopshop-web`: `npm run typecheck`

Expected: PASS after adapting explicit review fixtures/types.

- [ ] **Step 5: Commit in each repository.**

```bash
git add src/docs/openapi.ts tests/docs/openapi.test.ts
git commit -m "docs: publish helpful review api"
```

```bash
git add src/lib/api
git commit -m "chore: regenerate helpful review client"
```

### Task 5: Helpful storefront interaction

**Files:**
- Modify: `../laptopshop-web/src/features/reviews/hooks.ts`
- Create: `../laptopshop-web/src/features/reviews/HelpfulButton/HelpfulButton.tsx`
- Create: `../laptopshop-web/src/features/reviews/HelpfulButton/HelpfulButton.module.scss`
- Modify: `../laptopshop-web/src/features/reviews/ReviewCard/ReviewCard.tsx`
- Modify: `../laptopshop-web/src/features/reviews/ReviewList/ReviewList.tsx`
- Modify: `../laptopshop-web/src/features/reviews/ReviewSection/ReviewSection.tsx`
- Modify: `../laptopshop-web/src/lib/api/errors.ts`
- Test: `../laptopshop-web/tests/features/reviews/HelpfulButton.test.tsx`
- Test: `../laptopshop-web/tests/features/reviews/ReviewSection.test.tsx`
- Test: `../laptopshop-web/tests/features/reviews/hooks.test.tsx`

**Interfaces:**
- Consumes: helpful generated endpoints and `useMe`.
- Produces: batch `useHelpfulReviewIds(reviewIds, userId)`, `useToggleHelpful`, accessible optimistic button.

- [ ] **Step 1: Add failing hook tests** for disabled anonymous batch query, max-page ID batching, cache updates and mutation rollback.

- [ ] **Step 2: Add failing component tests** for count, `aria-pressed`, login redirect with product `#reviews`, self-vote disabled explanation and rollback on API failure.

- [ ] **Step 3: Implement hooks and `HelpfulButton`**; ReviewList requests viewer state once per visible page, never once per card.

- [ ] **Step 4: Run focused tests and CSS lint.**

Run from `../laptopshop-web`: `npm test -- tests/features/reviews/HelpfulButton.test.tsx tests/features/reviews/ReviewSection.test.tsx tests/features/reviews/hooks.test.tsx`

Run from `../laptopshop-web`: `npm run lint:css`

Expected: PASS.

- [ ] **Step 5: Commit in the web repository.**

```bash
git add src/features/reviews src/lib/api tests/features/reviews
git commit -m "feat: add helpful review interaction"
```

### Task 6: Phase 4B E2E and full verification

**Files:**
- Modify: `../laptopshop-web/e2e/storefront.spec.ts`
- Modify if required by findings: files from Tasks 1–5

**Interfaces:**
- Produces a releasable helpful-vote flow.

- [ ] **Step 1: Extend Playwright review lifecycle** with a second customer who votes, reloads and unvotes; assert author cannot self-vote and hidden review cannot be voted.

- [ ] **Step 2: Run API gates.**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int`

Expected: PASS.

- [ ] **Step 3: Run web gates.**

Run from `../laptopshop-web`: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && npm run e2e`

Expected: PASS.

- [ ] **Step 4: Run `git diff --check` in both repositories** and commit only E2E/verification fixes.

```bash
git commit -am "test: cover helpful review lifecycle"
```
