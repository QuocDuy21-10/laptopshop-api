# Product Reviews Phase 4C — Official Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép admin tạo, sửa và xoá mềm một phản hồi chính thức trên mỗi review, hiển thị công khai dưới danh nghĩa LaptopShop mà không lộ danh tính admin.

**Architecture:** `ReviewReply` là quan hệ one-to-one với review, lưu creator/updater để audit và dùng upsert/reactivation cho `PUT`. Public mapper chỉ trả content/timestamps; admin detail nhận audit fields; customer delete soft-delete reply trong cùng transaction.

**Tech Stack:** Express 5, TypeScript, Prisma/MySQL, Zod/OpenAPI, Jest/Supertest, Next.js, Ant Design admin, SCSS Modules storefront, React Query, Vitest/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-product-reviews-phase-4-design.md`

## Global Constraints

- Mỗi review có tối đa một reply; content trim, 1–1000 ký tự, body strict.
- Admin được reply review active `PUBLISHED` hoặc `HIDDEN`; review customer-deleted trả `409 REVIEW_DELETED`.
- `DELETE` reply idempotent; `PUT` tạo, cập nhật hoặc tái kích hoạt reply đã xoá mềm.
- Storefront chỉ hiển thị “Phản hồi từ LaptopShop”; không trả admin ID/name trong public DTO.
- Review hidden/deleted không hiển thị reply; restore hidden review hiển thị lại reply chưa bị customer-delete.
- Customer delete soft-delete reply; rewrite không tự khôi phục reply cũ.
- Admin routes phải ở admin router hiện có sau `authenticate + requireRole("ADMIN")`.

## Review Focus

- Hai admin `PUT` đồng thời không được tạo hai row; unique `reviewId` và integration test trong Task 2 bảo vệ.
- Reply trên review hidden phải xem được ở admin nhưng không public trước restore; route tests trong Task 3.
- Customer delete rồi rewrite không được làm reply cũ xuất hiện; lifecycle integration test trong Task 3.
- Public DTO/HTML không được lộ `createdById`, `updatedById`, username hoặc fullName admin; mapper/UI tests trong Tasks 3 và 5.
- Admin sửa/xoá lỗi phải giữ nội dung hiện tại và trình bày API error, không optimistic replace sai; frontend tests trong Task 4.

---

### Task 1: Official reply schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261021120000_add_review_replies/migration.sql`
- Modify: `tests/helpers/prisma.ts`
- Test: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Produces: Prisma `ReviewReply`, `Review.reply`, `User.reviewRepliesCreated`, `User.reviewRepliesUpdated` with named relations.

- [ ] **Step 1: Add failing integration tests** for one reply per review, creator/updater references and preservation across moderation.

- [ ] **Step 2: Add schema and generate additive migration** against `mysql-test`; inspect unique/index/foreign keys and `Restrict` behavior.

- [ ] **Step 3: Run Prisma generation and integration tests.**

Run: `npx prisma generate`

Run: `npm run test:int -- tests/integration/reviews.int.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add prisma tests/helpers/prisma.ts tests/integration/reviews.int.test.ts
git commit -m "feat: add official review reply schema"
```

### Task 2: Reply service, validation and admin routes

**Files:**
- Create: `src/modules/reviews/review-replies.service.ts`
- Modify: `src/modules/reviews/reviews.schema.ts`
- Modify: `src/modules/reviews/reviews.controller.ts`
- Modify: `src/modules/reviews/reviews.routes.ts`
- Test: `tests/modules/reviews/review-replies.routes.test.ts`
- Test: `tests/modules/reviews/reviews.schema.test.ts`
- Test: `tests/integration/review-replies.int.test.ts`

**Interfaces:**
- Produces: `putOfficialReply(adminId, reviewId, input)` and `deleteOfficialReply(adminId, reviewId)`.

- [ ] **Step 1: Add failing schema/route tests** for non-admin rejection, strict body, trim/length, create/update/reactivate, hidden review acceptance, deleted review conflict and idempotent delete.

- [ ] **Step 2: Add concurrent integration test** where two admins PUT the same reply and database retains one row with one final content/update actor.

- [ ] **Step 3: Implement signatures.**

```ts
export type PutReviewReplyBody = { content: string };
export const putOfficialReply: (adminId: number, reviewId: number, input: PutReviewReplyBody) => Promise<AdminReviewReplyDto>;
export const deleteOfficialReply: (adminId: number, reviewId: number) => Promise<void>;
```

Use `reviewId @unique` plus upsert/update retry; preserve original `createdById` on edits/reactivation and always set `updatedById`.

- [ ] **Step 4: Register admin routes** `PUT/DELETE /api/v1/admin/reviews/:id/reply` after static admin review routes and before conflicting parameter routes if needed.

- [ ] **Step 5: Run focused and integration tests.**

Run: `npm test -- tests/modules/reviews/review-replies.routes.test.ts tests/modules/reviews/reviews.schema.test.ts --runInBand`

Run: `npm run test:int -- tests/integration/review-replies.int.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/reviews tests/modules/reviews tests/integration/review-replies.int.test.ts
git commit -m "feat: manage official review replies"
```

### Task 3: Reply DTOs, public visibility and review deletion

**Files:**
- Modify: `src/modules/reviews/reviews.mapper.ts`
- Modify: `src/modules/reviews/reviews.service.ts`
- Test: `tests/modules/reviews/reviews.mapper.test.ts`
- Test: `tests/modules/reviews/reviews.routes.test.ts`
- Test: `tests/modules/reviews/admin-reviews.routes.test.ts`
- Test: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Produces: `PublicReviewDto.officialReply`, admin detail reply audit, customer-delete soft-delete behavior.

- [ ] **Step 1: Add failing mapper tests** asserting public reply has only `content/createdAt/updatedAt`; admin detail includes creator/updater identity; deleted reply maps to null.

- [ ] **Step 2: Add failing visibility tests** for published, hidden, restored and customer-deleted review states.

- [ ] **Step 3: Add failing delete/rewrite integration test** asserting reply soft-deletes with review and does not reactivate on rewrite.

- [ ] **Step 4: Extend selects/mappers and customer-delete transaction** without changing public author privacy or moderation semantics.

- [ ] **Step 5: Run review unit/integration suites.**

Run: `npm test -- tests/modules/reviews --runInBand`

Run: `npm run test:int -- tests/integration/reviews.int.test.ts tests/integration/review-replies.int.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/reviews tests/modules/reviews tests/integration
git commit -m "feat: publish official review replies"
```

### Task 4: OpenAPI and admin web editor

**Files:**
- Modify: `src/docs/openapi.ts`
- Test: `tests/docs/openapi.test.ts`
- Modify: `../laptopshop-web/src/lib/api/schema.d.ts`
- Modify: `../laptopshop-web/src/lib/api/types.ts`
- Modify: `../laptopshop-web/src/lib/api/query-keys.ts`
- Modify: `../laptopshop-web/src/features/admin/reviews/hooks.ts`
- Create: `../laptopshop-web/src/features/admin/reviews/ReviewReplyEditor.tsx`
- Modify: `../laptopshop-web/src/features/admin/reviews/ReviewDetail.tsx`
- Modify: `../laptopshop-web/src/lib/api/errors.ts`
- Test: `../laptopshop-web/tests/features/admin/ReviewReplyEditor.test.tsx`
- Test: `../laptopshop-web/tests/features/admin/ReviewDetail.test.tsx`

**Interfaces:**
- Produces: generated reply routes/types, `usePutReviewReply`, `useDeleteReviewReply`, admin editor.

- [ ] **Step 1: Add failing OpenAPI tests** for `PUT/DELETE`, strict body, public/admin DTOs and error responses.

- [ ] **Step 2: Register OpenAPI and regenerate web client** after docs tests pass.

- [ ] **Step 3: Add failing admin component/hook tests** for create, edit, delete confirmation, hidden review, deleted review read-only state and mutation errors retaining the current content.

- [ ] **Step 4: Implement hooks and editor** using Ant Design only under admin; invalidate `adminReview(id)`, admin lists and public reviews after settled mutation.

- [ ] **Step 5: Run focused tests and typechecks.**

Run: `npm test -- tests/docs/openapi.test.ts --runInBand`

Run from `../laptopshop-web`: `npm test -- tests/features/admin/ReviewReplyEditor.test.tsx tests/features/admin/ReviewDetail.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit in each repository.**

```bash
git add src/docs/openapi.ts tests/docs/openapi.test.ts
git commit -m "docs: publish official review reply api"
```

```bash
git add src/lib/api src/features/admin/reviews tests/features/admin
git commit -m "feat: manage official review replies"
```

### Task 5: Storefront official reply presentation

**Files:**
- Create: `../laptopshop-web/src/features/reviews/OfficialReply/OfficialReply.tsx`
- Create: `../laptopshop-web/src/features/reviews/OfficialReply/OfficialReply.module.scss`
- Modify: `../laptopshop-web/src/features/reviews/ReviewCard/ReviewCard.tsx`
- Modify: `../laptopshop-web/src/features/reviews/ReviewCard/ReviewCard.module.scss`
- Test: `../laptopshop-web/tests/features/reviews/OfficialReply.test.tsx`
- Test: `../laptopshop-web/tests/features/reviews/ReviewSection.test.tsx`

**Interfaces:**
- Consumes: `PublicReview.officialReply`.
- Produces: plain-text, accessible LaptopShop reply block with formatted timestamp.

- [ ] **Step 1: Add failing tests** for null reply, content/timestamps, fixed LaptopShop label, plain-text rendering and absence of all admin identity fields.

- [ ] **Step 2: Implement `OfficialReply`** with existing tokens/format utilities and no `dangerouslySetInnerHTML`.

- [ ] **Step 3: Integrate into ReviewCard** after customer content and before helpful/media footer placement defined by existing Phase 4 components.

- [ ] **Step 4: Run focused tests and CSS lint.**

Run from `../laptopshop-web`: `npm test -- tests/features/reviews/OfficialReply.test.tsx tests/features/reviews/ReviewSection.test.tsx`

Run from `../laptopshop-web`: `npm run lint:css`

Expected: PASS.

- [ ] **Step 5: Commit in the web repository.**

```bash
git add src/features/reviews tests/features/reviews
git commit -m "feat: display official review replies"
```

### Task 6: Phase 4C E2E and full verification

**Files:**
- Modify: `../laptopshop-web/e2e/storefront.spec.ts`
- Modify if required by findings: files from Tasks 1–5

**Interfaces:**
- Produces a releasable official-reply flow.

- [ ] **Step 1: Extend the Playwright review lifecycle** so admin replies, customer sees the LaptopShop reply, hide removes it publicly, restore returns it, and customer delete/rewrite does not restore it.

- [ ] **Step 2: Run API gates.**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int`

Expected: PASS.

- [ ] **Step 3: Run web gates.**

Run from `../laptopshop-web`: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && npm run e2e`

Expected: PASS.

- [ ] **Step 4: Run `git diff --check` in both repositories** and commit only E2E/verification fixes.

```bash
git commit -am "test: cover official review reply lifecycle"
```
