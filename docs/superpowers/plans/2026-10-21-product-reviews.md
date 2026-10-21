# Verified Product Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai MVP đánh giá sản phẩm từ khách mua thật trên API, Product Detail, Order Detail và Admin moderation, gồm lựa chọn ẩn danh, soft delete và chống duplicate đồng thời.

**Architecture:** Thêm module `reviews` vào Express modular monolith, lưu dữ liệu trong MySQL qua Prisma và xác minh quyền bằng `OrderDetail → Order`. OpenAPI là contract giữa API và Next.js; storefront dùng Server Component cho dữ liệu public ban đầu và client islands cho eligibility/mutations, còn admin tiếp tục dùng Ant Design.

**Tech Stack:** Express 5, TypeScript, Prisma 6, MySQL, Zod 3, Jest/Supertest, Next.js 16, React 19, TanStack Query 5, React Hook Form, Zod 4, SCSS Modules, Radix Dialog, Ant Design 6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-product-reviews-design.md`

## Global Constraints

- Đọc spec trước khi bắt đầu; không mở rộng sang ảnh review, helpful vote, shop reply, reminder hoặc ProductCard rating.
- API không đọc `process.env` ngoài `src/config/env.ts`, không dùng `console`, dùng `AppError` với stable code và bare path aliases.
- Không trả Prisma rows; mọi response đi qua mapper allow-list.
- Customer ownership luôn scope bằng `req.auth.id`; không nhận `userId`, `orderDetailId`, status hoặc moderation fields từ client.
- Route `/api/v1` mới phải cập nhật `src/docs/openapi.ts` và `tests/docs/openapi.test.ts`.
- Migration chỉ tạo trên `mysql-test`; không chạy `prisma migrate reset` hoặc `db push` lên database thật.
- Storefront dùng Vietnamese copy, SCSS Modules, tokens trong `DESIGN.md`, touch target tối thiểu 44px và không dùng `dangerouslySetInnerHTML`.
- Admin dùng Ant Design chỉ dưới `/admin`; generated `src/lib/api/schema.d.ts` không sửa tay.
- Mỗi task đi theo TDD: test fail → code tối thiểu → test pass → commit; không push nếu chưa có yêu cầu riêng.
- Trước khi thực thi, dùng `superpowers:using-git-worktrees` hoặc checkout feature branch tương ứng cho cả hai repository; tuyệt đối không commit các Task 7–12 trực tiếp lên `laptopshop-web/develop`.

## Review Focus

- Hai request create/reactivate đồng thời: đúng một request thành công, request còn lại nhận `REVIEW_ALREADY_EXISTS`; Task 3 và Task 4 có real-MySQL tests.
- Review từng bị admin ẩn không được dùng delete → rewrite để tự public lại; Task 4 có route và integration tests.
- Công khai tên khi thiếu `fullName`, kể cả dữ liệu legacy: create/update bị từ chối và public mapper không rò `username`; Task 2 và Task 3 có tests.
- Product inactive: public review endpoints trả 404 nhưng khách đã mua vẫn create/update từ Order Detail; Task 2, Task 3 và Task 10 có tests.
- Session/cache boundary: eligibility key phải chứa `userId`, logout/login không dùng dữ liệu quyền của tài khoản trước; Task 7 và Task 9 có hook/component tests.

---

### Task 1: Prisma model, migration và database invariants

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*_add_product_reviews/migration.sql` (directory timestamp do Prisma sinh ở Step 3)
- Modify: `tests/integration/fixtures.ts`
- Create: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Consumes: `User`, `Product`, `OrderDetail` và MySQL test runtime hiện có.
- Produces: Prisma `Review`, `ReviewStatus`, relations `User.reviews`, `User.moderatedReviews`, `Product.reviews`, `OrderDetail.review`; helper fixtures `createCompletedOrderItem(userId, productId)`.

- [ ] **Step 1: Viết integration tests thất bại cho database constraints**

Trong `tests/integration/reviews.int.test.ts`, thêm các test:

```ts
it("rejects rating outside 1..5 at the database boundary")
it("allows only one review per user and product")
it("allows only one review per order detail")
it("keeps author, product and purchase evidence referenced")
```

Mỗi test tạo user, product và completed order item thật; assert lỗi MySQL/Prisma cho rating `0`, duplicate `(userId, productId)` và duplicate `orderDetailId`.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm run test:int -- --runTestsByPath tests/integration/reviews.int.test.ts`

Expected: FAIL vì Prisma client chưa có `review`/`ReviewStatus` và migration chưa tồn tại.

- [ ] **Step 3: Thêm schema, fixtures và tạo migration chưa áp dụng**

Thêm model đúng spec, gồm `contentUpdatedAt`, hai unique constraints và hai indexes. Cập nhật `resetDb()` xóa reviews trước order details/users; thêm fixture tạo order `COMPLETED + PAYMENT_SUCCESS` và trả `OrderDetail`.

Run:

```bash
docker compose --profile test up -d mysql-test
DATABASE_URL=mysql://root:test@127.0.0.1:3307/laptopshop_test npx prisma migrate dev --create-only --name add_product_reviews
```

Expected: Prisma tạo directory `*_add_product_reviews` nhưng chưa apply migration.

- [ ] **Step 4: Thêm database check rồi apply migration**

Dùng `apply_patch` thêm `CHECK (rating BETWEEN 1 AND 5)` vào migration vừa sinh, sau đó chạy:

```bash
DATABASE_URL=mysql://root:test@127.0.0.1:3307/laptopshop_test npx prisma migrate dev
npx prisma generate
```

Expected: migration apply thành công và generated client có `prisma.review`.

- [ ] **Step 5: Chạy integration test và schema checks**

Run: `npm run test:int -- --runTestsByPath tests/integration/reviews.int.test.ts`

Expected: PASS 4 tests.

Run: `npx prisma validate`

Expected: `The schema ... is valid`.

- [ ] **Step 6: Commit database foundation**

```bash
git add prisma/schema.prisma prisma/migrations/*_add_product_reviews tests/integration/fixtures.ts tests/integration/reviews.int.test.ts
git commit -m "feat: add product review data model"
```

### Task 2: Public review schemas, mapper, list và summary

**Files:**
- Create: `src/modules/reviews/reviews.schema.ts`
- Create: `src/modules/reviews/reviews.mapper.ts`
- Create: `src/modules/reviews/reviews.service.ts`
- Create: `src/modules/reviews/reviews.controller.ts`
- Create: `src/modules/reviews/reviews.routes.ts`
- Modify: `src/routes/index.ts`
- Create: `tests/modules/reviews/reviews.schema.test.ts`
- Create: `tests/modules/reviews/reviews.mapper.test.ts`
- Create: `tests/modules/reviews/reviews.routes.test.ts`

**Interfaces:**
- Consumes: Prisma `Review`, `pageQuery`, `pageArgs`, `pageMeta`, `validate`, `notFound`.
- Produces: `ListProductReviewsQuery`, `PublicReviewDto`, `ReviewSummaryDto`, `listPublishedReviews(productId, query)`, `getPublishedReviewSummary(productId)`, `productReviewRoutes`.

- [ ] **Step 1: Viết schema/mapper/route tests thất bại**

Tests phải pin:

```ts
expect(listProductReviewsQuery.parse({ rating: "5", sort: "highest" })).toMatchObject({ rating: 5, sort: "highest" })
expect(toPublicReviewDto(anonymousRow).author).toEqual({ name: "****", anonymous: true })
expect(toPublicReviewDto(legacyNamedRow).author.name).toBe("Khách hàng LaptopShop")
expect(publicDto).not.toHaveProperty("userId")
```

Route tests assert list chỉ query `PUBLISHED + deletedAt: null`, sort có tie-breaker, hidden/deleted không vào summary, empty summary trả `averageRating: null`, và inactive product trả 404.

- [ ] **Step 2: Chạy focused tests để xác nhận fail**

Run: `npx jest tests/modules/reviews/reviews.schema.test.ts tests/modules/reviews/reviews.mapper.test.ts tests/modules/reviews/reviews.routes.test.ts --runInBand`

Expected: FAIL vì module chưa tồn tại.

- [ ] **Step 3: Implement public read interfaces**

Tạo:

```ts
export const listProductReviewsQuery: ZodSchema<ListProductReviewsQuery>
export function toPublicReviewDto(row: PublicReviewRow): PublicReviewDto
export async function listPublishedReviews(productId: number, q: ListProductReviewsQuery): Promise<{ items: PublicReviewDto[]; meta: PageMeta }>
export async function getPublishedReviewSummary(productId: number): Promise<ReviewSummaryDto>
```

`productReviewRoutes` khai báo GET `/:id/reviews` và `/:id/reviews/summary`. Public mapper ánh xạ `contentUpdatedAt` thành `updatedAt`; summary dùng một `groupBy`.

- [ ] **Step 4: Chạy focused tests**

Run: `npx jest tests/modules/reviews/reviews.schema.test.ts tests/modules/reviews/reviews.mapper.test.ts tests/modules/reviews/reviews.routes.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit public reviews**

```bash
git add src/modules/reviews src/routes/index.ts tests/modules/reviews
git commit -m "feat: expose public product reviews"
```

### Task 3: Eligibility và create review

**Files:**
- Modify: `src/modules/reviews/reviews.schema.ts`
- Modify: `src/modules/reviews/reviews.mapper.ts`
- Modify: `src/modules/reviews/reviews.service.ts`
- Modify: `src/modules/reviews/reviews.controller.ts`
- Modify: `src/modules/reviews/reviews.routes.ts`
- Modify: `tests/modules/reviews/reviews.schema.test.ts`
- Modify: `tests/modules/reviews/reviews.routes.test.ts`
- Modify: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Consumes: Task 2 module boundaries, `authenticate`, `ORDER_STATUS.COMPLETED`, `PAYMENT_STATUS.SUCCESS`.
- Produces: `CreateReviewBody`, `ReviewEligibilityDto`, `getReviewEligibility(userId, productId)`, `createReview(userId, productId, input)`.

- [ ] **Step 1: Viết failing tests cho eligibility/create**

Route tests assert 401 anonymous; precedence `ALREADY_REVIEWED`, eligible purchase, `NOT_PURCHASED`, `PAYMENT_NOT_CONFIRMED`, `ORDER_NOT_COMPLETED`; body bắt buộc `isAnonymous`; public-name create thiếu `fullName` trả `409 REVIEW_FULL_NAME_REQUIRED`; inactive product đã mua vẫn create 201; client-supplied `userId/orderDetailId/status` bị 400.

Integration test:

```ts
it("lets exactly one of two concurrent createReview calls win")
```

Assert một fulfilled result và một `REVIEW_ALREADY_EXISTS`, database có đúng một row.

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run: `npx jest tests/modules/reviews/reviews.schema.test.ts tests/modules/reviews/reviews.routes.test.ts --runInBand`

Expected: FAIL ở endpoints/functions mới.

- [ ] **Step 3: Implement eligibility và create**

Tạo signatures:

```ts
export async function getReviewEligibility(userId: number, productId: number): Promise<ReviewEligibilityDto>
export async function createReview(userId: number, productId: number, input: CreateReviewBody): Promise<OwnerReviewDto>
```

Mount authenticated GET `/:id/reviews/eligibility` và POST `/:id/reviews`. Tự chọn purchase evidence gần nhất, không tin eligibility cache, bắt `P2002` thành `REVIEW_ALREADY_EXISTS`.

- [ ] **Step 4: Chạy route và integration tests**

Run: `npx jest tests/modules/reviews/reviews.schema.test.ts tests/modules/reviews/reviews.routes.test.ts --runInBand`

Expected: PASS.

Run: `npm run test:int -- --runTestsByPath tests/integration/reviews.int.test.ts`

Expected: PASS, gồm concurrent create.

- [ ] **Step 5: Commit eligibility/create**

```bash
git add src/modules/reviews tests/modules/reviews tests/integration/reviews.int.test.ts
git commit -m "feat: verify review purchase eligibility"
```

### Task 4: Customer update, soft delete và safe reactivation

**Files:**
- Modify: `src/modules/reviews/reviews.schema.ts`
- Modify: `src/modules/reviews/reviews.service.ts`
- Modify: `src/modules/reviews/reviews.controller.ts`
- Modify: `src/modules/reviews/reviews.routes.ts`
- Modify: `tests/modules/reviews/reviews.routes.test.ts`
- Modify: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Consumes: `OwnerReviewDto`, `CreateReviewBody`, active/deleted review state.
- Produces: `UpdateReviewBody`, `updateMyReview(userId, reviewId, input)`, `deleteMyReview(userId, reviewId)` và conditional reactivation trong `createReview`.

- [ ] **Step 1: Viết failing lifecycle tests**

Route tests assert owner update; other owner/missing cùng 404; hidden update giữ `HIDDEN` và tăng `contentUpdatedAt`; public-name update thiếu `fullName` trả `REVIEW_FULL_NAME_REQUIRED`; product inactive vẫn update được; deleted update trả `REVIEW_DELETED`; DELETE đặt `deletedAt` và lặp lại vẫn 204; write lại public row thành `PUBLISHED`; write lại hidden row vẫn `HIDDEN`.

Integration test:

```ts
it("lets exactly one concurrent reactivation clear deletedAt")
it("never republishes a hidden review through delete and rewrite")
```

- [ ] **Step 2: Chạy focused tests để xác nhận fail**

Run: `npx jest tests/modules/reviews/reviews.routes.test.ts --runInBand`

Expected: FAIL ở PATCH/DELETE/reactivation.

- [ ] **Step 3: Implement owner lifecycle**

Tạo:

```ts
export async function updateMyReview(userId: number, reviewId: number, input: UpdateReviewBody): Promise<OwnerReviewDto>
export async function deleteMyReview(userId: number, reviewId: number): Promise<void>
```

Mount `reviewRoutes` tại `/reviews`. Reactivation dùng `updateMany({ where: { id, userId, deletedAt: { not: null } } })`; `count = 0` trả `REVIEW_ALREADY_EXISTS`.

- [ ] **Step 4: Chạy lifecycle tests**

Run: `npx jest tests/modules/reviews/reviews.routes.test.ts --runInBand`

Expected: PASS.

Run: `npm run test:int -- --runTestsByPath tests/integration/reviews.int.test.ts`

Expected: PASS concurrent reactivation và hidden anti-bypass.

- [ ] **Step 5: Commit customer lifecycle**

```bash
git add src/modules/reviews src/routes/index.ts tests/modules/reviews/reviews.routes.test.ts tests/integration/reviews.int.test.ts
git commit -m "feat: manage customer review lifecycle"
```

### Task 5: Admin review queries và moderation

**Files:**
- Modify: `src/modules/reviews/reviews.schema.ts`
- Modify: `src/modules/reviews/reviews.mapper.ts`
- Modify: `src/modules/reviews/reviews.service.ts`
- Modify: `src/modules/reviews/reviews.controller.ts`
- Modify: `src/modules/reviews/reviews.routes.ts`
- Modify: `src/routes/index.ts`
- Create: `tests/modules/reviews/admin-reviews.routes.test.ts`
- Modify: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Consumes: customer/public review records và admin router guard.
- Produces: `AdminListReviewsQuery`, `ModerateReviewBody`, `listAdminReviews`, `getAdminReviewSummary`, `getAdminReview`, `moderateReview`, `adminReviewRoutes`.

- [ ] **Step 1: Viết failing admin tests**

Assert non-admin 403; filters product/rating/status/deleted/date/search; summary chỉ average public active; detail có author và purchase evidence nhưng không có receiver/payment payload; hide thiếu reason 400; hide ghi actor/time/reason; restore clear reason; deleted restore 409; public-on-public không đổi moderation metadata; hidden-on-hidden cập nhật reason.

Integration test assert summary thay đổi đúng qua create → hide → restore → delete.

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run: `npx jest tests/modules/reviews/admin-reviews.routes.test.ts --runInBand`

Expected: FAIL vì admin endpoints chưa tồn tại.

- [ ] **Step 3: Implement admin interfaces**

Tạo:

```ts
export async function listAdminReviews(q: AdminListReviewsQuery): Promise<{ items: AdminReviewListItemDto[]; meta: PageMeta }>
export async function getAdminReviewSummary(): Promise<AdminReviewSummaryDto>
export async function getAdminReview(id: number): Promise<AdminReviewDetailDto>
export async function moderateReview(adminId: number, id: number, input: ModerateReviewBody): Promise<AdminReviewDetailDto>
```

Mount `adminReviewRoutes` dưới `/api/v1/admin/reviews`; không expose mutation sửa content/rating.

- [ ] **Step 4: Chạy admin và integration tests**

Run: `npx jest tests/modules/reviews/admin-reviews.routes.test.ts --runInBand`

Expected: PASS.

Run: `npm run test:int -- --runTestsByPath tests/integration/reviews.int.test.ts`

Expected: PASS summary lifecycle.

- [ ] **Step 5: Commit moderation API**

```bash
git add src/modules/reviews src/routes/index.ts tests/modules/reviews/admin-reviews.routes.test.ts tests/integration/reviews.int.test.ts
git commit -m "feat: add review moderation api"
```

### Task 6: OpenAPI contract và API regression gate

**Files:**
- Modify: `src/docs/openapi.ts`
- Modify: `tests/docs/openapi.test.ts`
- Modify: `tests/routes/v1.test.ts`

**Interfaces:**
- Consumes: tất cả DTO/schema/routes từ Tasks 2–5.
- Produces: OpenAPI schemas `PublicReview`, `ReviewSummary`, `ReviewEligibility`, `OwnerReview`, `AdminReviewListItem`, `AdminReviewDetail`, `AdminReviewSummary`; typed paths cho web.

- [ ] **Step 1: Viết failing OpenAPI assertions**

Assert đủ tám route groups, public routes không security, customer/admin routes có cookie/bearer security, create body bắt buộc `rating/content/isAnonymous`, và public schema không chứa `userId`, `username`, `orderDetailId`, `status`.

- [ ] **Step 2: Chạy docs tests để xác nhận fail**

Run: `npx jest tests/docs/openapi.test.ts tests/routes/v1.test.ts --runInBand`

Expected: FAIL vì paths/schemas chưa đăng ký.

- [ ] **Step 3: Đăng ký OpenAPI schemas và paths**

Reuse Zod schemas khi phù hợp; owner/admin/public response schemas tách riêng để ngăn field leakage. Gắn response codes 200/201/204/400/401/403/404/409.

- [ ] **Step 4: Chạy API regression suite**

Run: `npx jest tests/docs/openapi.test.ts tests/routes/v1.test.ts --runInBand`

Expected: PASS.

Run: `npm run lint && npm run typecheck && npm test`

Expected: exit 0; không có test failure.

- [ ] **Step 5: Commit API contract**

```bash
git add src/docs/openapi.ts tests/docs/openapi.test.ts tests/routes/v1.test.ts
git commit -m "docs: publish product review api contract"
```

### Task 7: Generated web client và review data layer

**Files:**
- Modify: `../laptopshop-web/src/lib/api/schema.d.ts`
- Modify: `../laptopshop-web/src/lib/api/types.ts`
- Modify: `../laptopshop-web/src/lib/api/query-keys.ts`
- Modify: `../laptopshop-web/src/lib/api/errors.ts`
- Create: `../laptopshop-web/src/features/reviews/server.ts`
- Create: `../laptopshop-web/src/features/reviews/hooks.ts`
- Create: `../laptopshop-web/tests/features/reviews/hooks.test.tsx`
- Modify: `../laptopshop-web/tests/lib/errors.test.ts`

**Interfaces:**
- Consumes: Task 6 OpenAPI JSON từ API đang chạy với `ENABLE_DOCS=true`.
- Produces: exported `PublicReview`, `ReviewSummary`, `ReviewEligibility`, `OwnerReview`, admin review types; query keys; `getInitialReviews(productId: number): Promise<{ summary: ReviewSummary; page: { data: PublicReview[]; meta: PageMeta } }>`; `useReviewSummary(productId)`, `useProductReviews(productId, query)`, `useReviewEligibility(productId, userId, enabled?)`.

- [ ] **Step 1: Viết failing hook/error tests**

Assert eligibility query disabled khi `userId` absent; keys khác nhau cho hai user; summary/list keys cùng prefix product; 401 eligibility không làm public list fail; error codes có Vietnamese copy.

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run from web: `npm test -- tests/features/reviews/hooks.test.tsx tests/lib/errors.test.ts`

Expected: FAIL vì types/hooks/query keys chưa có.

- [ ] **Step 3: Generate contract và implement data layer**

Start API docs runtime, then run from web:

```bash
npm run gen:api
```

Thêm exact query keys trong spec; `server.ts` dùng `freshServerApi`; hooks dùng `api`, `unwrap`, `keepPreviousData` và generated path types. Chưa thêm mutation hooks ở task này.

- [ ] **Step 4: Chạy focused web tests và typecheck**

Run: `npm test -- tests/features/reviews/hooks.test.tsx tests/lib/errors.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit generated contract/data layer trong web repo**

```bash
git add src/lib/api/schema.d.ts src/lib/api/types.ts src/lib/api/query-keys.ts src/lib/api/errors.ts src/features/reviews/server.ts src/features/reviews/hooks.ts tests/features/reviews/hooks.test.tsx tests/lib/errors.test.ts
git commit -m "feat: add review api client"
```

### Task 8: Public ReviewSection trên Product Detail

**Files:**
- Create: `../laptopshop-web/src/features/reviews/ReviewSummary/ReviewSummary.tsx`
- Create: `../laptopshop-web/src/features/reviews/ReviewSummary/ReviewSummary.module.scss`
- Create: `../laptopshop-web/src/features/reviews/ReviewCard/ReviewCard.tsx`
- Create: `../laptopshop-web/src/features/reviews/ReviewCard/ReviewCard.module.scss`
- Create: `../laptopshop-web/src/features/reviews/ReviewList/ReviewList.tsx`
- Create: `../laptopshop-web/src/features/reviews/ReviewList/ReviewList.module.scss`
- Create: `../laptopshop-web/src/features/reviews/ReviewSection/ReviewSection.tsx`
- Create: `../laptopshop-web/src/features/reviews/ReviewSection/ReviewSection.module.scss`
- Modify: `../laptopshop-web/src/app/(storefront)/products/[id]/page.tsx`
- Modify: `../laptopshop-web/src/app/(storefront)/products/[id]/page.module.scss`
- Create: `../laptopshop-web/tests/features/reviews/ReviewSection.test.tsx`

**Interfaces:**
- Consumes: `getInitialReviews`, `useReviewSummary`, `useProductReviews`, public DTOs từ Task 7.
- Produces: `<ReviewSection productId initialSummary initialPage />` với filter/sort/pagination và anchor `reviews`.

- [ ] **Step 1: Viết failing component tests**

Assert empty state không hiện `0 sao`; distribution có text counts; anonymous hiển thị `****`; public hiển thị full name; filter/sort gửi đúng query; page error có retry; content được render text, không HTML; layout control có accessible names.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npm test -- tests/features/reviews/ReviewSection.test.tsx`

Expected: FAIL vì components chưa tồn tại.

- [ ] **Step 3: Implement public components và server initial data**

Product page tải product/options/review initial data song song. Chỉ gắn `ReviewSection` dưới spec/description; chưa thêm mutation form. CSS dùng semantic tokens, mobile-first, 320px-safe và 44px controls.

- [ ] **Step 4: Chạy component/style checks**

Run: `npm test -- tests/features/reviews/ReviewSection.test.tsx`

Expected: PASS.

Run: `npm run lint:css && npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit public review UI**

```bash
git add src/features/reviews src/app/'(storefront)'/products/'[id]'/page.tsx src/app/'(storefront)'/products/'[id]'/page.module.scss tests/features/reviews/ReviewSection.test.tsx
git commit -m "feat: show reviews on product detail"
```

### Task 9: ReviewForm, customer actions và cache safety

**Files:**
- Create: `../laptopshop-web/src/features/reviews/schema.ts`
- Create: `../laptopshop-web/src/features/reviews/ReviewForm/ReviewForm.tsx`
- Create: `../laptopshop-web/src/features/reviews/ReviewForm/ReviewForm.module.scss`
- Create: `../laptopshop-web/src/features/reviews/ReviewDialog/ReviewDialog.tsx`
- Modify: `../laptopshop-web/src/features/reviews/ReviewSection/ReviewSection.tsx`
- Modify: `../laptopshop-web/src/features/reviews/hooks.ts`
- Create: `../laptopshop-web/tests/features/reviews/ReviewForm.test.tsx`
- Modify: `../laptopshop-web/tests/features/reviews/ReviewSection.test.tsx`
- Modify: `../laptopshop-web/tests/features/reviews/hooks.test.tsx`

**Interfaces:**
- Consumes: eligibility/read hooks và query keys từ Task 7, Dialog/Button/TextField/Alert hiện có.
- Produces: `reviewSchema`, `ReviewInput`, create/update/delete hooks; `ReviewDialog({ productId, productName, eligibility, open, onOpenChange })`; customer action states trong `ReviewSection`.

- [ ] **Step 1: Viết failing form/action tests**

Assert create form bắt buộc rating/content/identity; star radios keyboard accessible; public option disabled và có profile link khi thiếu full name; edit prefill identity; hidden edit warning; delete confirm; mutation invalidates product prefix và eligibility key chứa current user; đổi user không reuse eligibility cũ.

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run: `npm test -- tests/features/reviews/ReviewForm.test.tsx tests/features/reviews/ReviewSection.test.tsx tests/features/reviews/hooks.test.tsx`

Expected: FAIL ở form/mutations/states mới.

- [ ] **Step 3: Implement form, dialog và mutations**

Tạo mutation hooks `useCreateReview`, `useUpdateReview`, `useDeleteReview`; on success invalidate `queryKeys.reviews(productId)` và user eligibility. Dùng radio inputs thật, `applyFieldErrors`, `errorMessage`, focus-safe Radix Dialog và delete confirmation.

- [ ] **Step 4: Chạy focused tests và accessibility lint**

Run: `npm test -- tests/features/reviews/ReviewForm.test.tsx tests/features/reviews/ReviewSection.test.tsx tests/features/reviews/hooks.test.tsx`

Expected: PASS.

Run: `npm run lint && npm run lint:css && npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit customer review interactions**

```bash
git add src/features/reviews tests/features/reviews
git commit -m "feat: let customers manage reviews"
```

### Task 10: Lazy ReviewAction trong Order Detail

**Files:**
- Create: `../laptopshop-web/src/features/reviews/ReviewAction/ReviewAction.tsx`
- Modify: `../laptopshop-web/src/features/orders/OrderDetail/OrderDetail.tsx`
- Modify: `../laptopshop-web/src/features/orders/OrderDetail/OrderDetail.module.scss`
- Create: `../laptopshop-web/tests/features/reviews/ReviewAction.test.tsx`
- Modify: `../laptopshop-web/tests/features/orders.test.tsx`

**Interfaces:**
- Consumes: `ReviewDialog`, eligibility/mutation hooks, `Order` generated type.
- Produces: `<ReviewAction productId productName />`, gọi `useReviewEligibility(productId, userId, opened)` để chỉ fetch eligibility sau click.

- [ ] **Step 1: Viết failing Order Detail tests**

Assert CTA chỉ hiện khi `COMPLETED + PAYMENT_SUCCESS`; render một CTA mỗi item; chưa click không gọi eligibility; click mới fetch và mở dialog; inactive product vẫn dùng dialog tại chỗ, không điều hướng Product Detail.

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run: `npm test -- tests/features/reviews/ReviewAction.test.tsx tests/features/orders.test.tsx`

Expected: FAIL vì ReviewAction chưa có.

- [ ] **Step 3: Implement lazy ReviewAction**

Component giữ `enabled` false trước click, sau click kích hoạt eligibility và mở loading state trong dialog; reuse ReviewDialog cho create/edit/hidden/deleted states.

- [ ] **Step 4: Chạy Order Detail tests**

Run: `npm test -- tests/features/reviews/ReviewAction.test.tsx tests/features/orders.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit Order Detail integration**

```bash
git add src/features/reviews/ReviewAction src/features/orders/OrderDetail tests/features/reviews/ReviewAction.test.tsx tests/features/orders.test.tsx
git commit -m "feat: review products from order detail"
```

### Task 11: Admin review list, detail và moderation UI

**Files:**
- Modify: `../laptopshop-web/src/features/admin/AdminShell/AdminShell.tsx`
- Modify: `../laptopshop-web/src/lib/api/query-keys.ts`
- Create: `../laptopshop-web/src/features/admin/reviews/hooks.ts`
- Create: `../laptopshop-web/src/features/admin/reviews/ReviewStatusTag.tsx`
- Create: `../laptopshop-web/src/features/admin/reviews/ReviewsTable.tsx`
- Create: `../laptopshop-web/src/features/admin/reviews/ReviewList.tsx`
- Create: `../laptopshop-web/src/features/admin/reviews/ReviewDetail.tsx`
- Create: `../laptopshop-web/src/features/admin/reviews/ReviewModerationActions.tsx`
- Create: `../laptopshop-web/src/app/(admin)/admin/reviews/page.tsx`
- Create: `../laptopshop-web/src/app/(admin)/admin/reviews/[id]/page.tsx`
- Create: `../laptopshop-web/tests/features/admin/ReviewList.test.tsx`
- Create: `../laptopshop-web/tests/features/admin/ReviewDetail.test.tsx`
- Modify: `../laptopshop-web/tests/features/admin/InventoryNav.test.tsx`

**Interfaces:**
- Consumes: generated admin review DTOs, `useListParams`, `queryKeys.adminAll`, AdminShell/AntD patterns.
- Produces: `/admin/reviews`, `/admin/reviews/:id`, filterable table, hide/restore mutations.

- [ ] **Step 1: Viết failing admin UI tests**

Assert nav có “Đánh giá”; URL filters parse đúng; KPI dùng API data; anonymous vẫn hiện author thật kèm tag; deleted row không có moderation action; hide bắt buộc reason; restore có confirmation; `contentUpdatedAt > moderatedAt` hiện cảnh báo; detail link tới admin order; 404 Result.

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run: `npm test -- tests/features/admin/ReviewList.test.tsx tests/features/admin/ReviewDetail.test.tsx tests/features/admin/InventoryNav.test.tsx`

Expected: FAIL vì routes/components chưa có.

- [ ] **Step 3: Implement admin review UI**

Hooks dùng generated paths, `keepPreviousData`, URL filters và invalidate `queryKeys.adminAll` plus product review prefix sau moderation. Hide Modal có maxLength 500; restore Popconfirm; không optimistic update.

- [ ] **Step 4: Chạy admin tests và web static checks**

Run: `npm test -- tests/features/admin/ReviewList.test.tsx tests/features/admin/ReviewDetail.test.tsx tests/features/admin/InventoryNav.test.tsx`

Expected: PASS.

Run: `npm run lint && npm run lint:css && npm run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit admin moderation UI**

```bash
git add src/features/admin src/app/'(admin)'/admin/reviews src/lib/api/query-keys.ts tests/features/admin
git commit -m "feat: moderate product reviews in admin"
```

### Task 12: E2E lifecycle và final verification

**Files:**
- Modify: `../laptopshop-web/e2e/helpers.ts`
- Modify: `../laptopshop-web/e2e/storefront.spec.ts`
- Modify: `../laptopshop-web/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: toàn bộ API/web từ Tasks 1–11, API :8080, web :3000, MySQL test/dev và seeded admin.
- Produces: proof E2E cho create → hide → edit → restore → anonymize → delete → rewrite; final verified branch state.

- [ ] **Step 1: Viết failing E2E scenario và helper setup**

Viết scenario gọi helper chưa tồn tại `createCompletedReviewOrder()`. Scenario assert review public, summary thay đổi, admin hide, customer edit vẫn hidden, admin restore, anonymous hiện `****`, delete biến mất và rewrite tuân moderation policy. Thêm bước chạy cùng form bằng keyboard và kiểm tra `document.documentElement.scrollWidth <= window.innerWidth` tại viewport 320px.

- [ ] **Step 2: Chạy E2E để xác nhận fail trước khi hoàn thiện fixture/selectors**

Run from web with API running: `npm run e2e -- --grep "verified product review"`

Expected: FAIL vì `createCompletedReviewOrder` chưa được export; nếu API/MySQL không chạy, ghi rõ runtime blocker thay vì sửa product code đoán mò.

- [ ] **Step 3: Hoàn thiện deterministic E2E setup và selectors**

Implement `createCompletedReviewOrder(request)` trong `e2e/helpers.ts`. Không phụ thuộc review/order có sẵn; dùng unique email/product data, backend-confirmed order transition và accessible role/label selectors. Customer và admin chạy trong hai browser context riêng để cookie đăng nhập không ghi đè nhau. Không đọc `.env*` nếu chưa được cho phép.

- [ ] **Step 4: Chạy toàn bộ verification**

API:

```bash
npm run lint
npm run typecheck
npm test
npm run test:int
npm run build
git diff --check
```

Web:

```bash
npm run lint
npm run lint:css
npm run typecheck
npm test
npm run build
npm run e2e
git diff --check
```

Expected: tất cả exit 0. Nếu production build hoặc E2E bị chặn bởi API/network/runtime, báo chính xác `NOT VERIFIED` cùng command/output; không đổi thành success claim.

- [ ] **Step 5: Commit E2E/runbook và chuẩn bị review cuối**

```bash
git add e2e
git commit -m "test: cover verified review lifecycle"
```

Sau commit, dùng `superpowers:requesting-code-review` để review toàn branch, sửa finding theo `superpowers:receiving-code-review`, rồi chạy lại verification trước khi chọn merge/push.
