# Product Reviews Phase 4A — Review Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép owner thêm, xoá và sắp xếp tối đa ba ảnh đã chuẩn hoá cho review, dùng RustFS local và S3-compatible private storage ở production.

**Architecture:** API xác minh owner trước khi xử lý multipart, chuẩn hoá ảnh trong memory, giữ lifecycle `PENDING → READY → DELETING` trong MySQL và đưa object operations qua `ReviewImageStorage`. Storefront lưu review JSON trước rồi upload ảnh, hiển thị partial-success/retry rõ ràng; public/admin DTO chỉ nhận signed read URL sau khi áp dụng authorization.

**Tech Stack:** Express 5, TypeScript, Prisma 6/MySQL 8.4, Multer memory storage, Sharp, AWS SDK v3 S3 client/presigner, RustFS, Jest/Supertest, Next.js 16, React Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-21-product-reviews-phase-4-design.md`

## Global Constraints

- Tối đa 3 ảnh `PENDING/READY` chưa xoá trên một review; tối đa 3 MB mỗi file.
- Chỉ nhận JPEG, PNG, WebP theo magic bytes và decode thực tế; output luôn WebP, tối đa `1600 × 1600`, không upscale, không EXIF/GPS.
- Bucket private; signed read URL mặc định 900 giây; public review phải `PUBLISHED AND deletedAt IS NULL`.
- Owner được quản lý ảnh của review `PUBLISHED` hoặc `HIDDEN`, không được thao tác trên review đã xoá.
- Không đọc `process.env` ngoài `src/config/env.ts`; không log secrets, signed URL đầy đủ hoặc buffers.
- Dùng bare aliases trong API, SCSS Modules và Vietnamese copy trong storefront, touch target tối thiểu 44px.
- Mọi route mới phải có OpenAPI và regenerated client; không trả Prisma row hoặc `objectKey` trong public/owner DTO.
- API gate: `npm run lint && npm run typecheck && npm test && npm run test:int`.
- Web gate: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && npm run e2e`.

## Review Focus

- Hai upload đồng thời khi review còn một slot phải chỉ có một request giữ được slot; integration test trong Task 5 khóa review và assert tổng `PENDING/READY <= 3`.
- File giả MIME, file truncated và ảnh vượt pixel limit phải bị từ chối trước storage; processor tests trong Task 3 pin từng input.
- Crash/lỗi giữa DB reservation, object upload và `READY` không được làm ảnh hỏng xuất hiện; lifecycle/reconciliation tests trong Tasks 5 và 8 pin các state treo.
- Review vừa bị hidden/deleted không được cấp URL mới dù row ảnh còn `READY`; presenter/route tests trong Task 7 kiểm tra public, owner và admin contexts.
- Review JSON đã lưu nhưng upload lỗi phải được báo partial success và retry không tạo review thứ hai; frontend tests trong Task 10 pin luồng này.

---

### Task 1: Storage configuration and injectable S3 adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Create: `src/lib/storage/review-image-storage.ts`
- Create: `src/lib/storage/s3-review-image-storage.ts`
- Test: `tests/config/env.test.ts`
- Test: `tests/lib/s3-review-image-storage.test.ts`

**Interfaces:**
- Produces: `ReviewImageStorage`, `PutReviewImageObject`, `createReviewImageStorage(config): ReviewImageStorage | null`.
- Produces config fields `REVIEW_IMAGES_ENABLED`, `REVIEW_IMAGE_S3_*`, `REVIEW_IMAGE_URL_TTL_SECONDS` exactly as the spec.

- [ ] **Step 1: Add failing environment tests** for disabled defaults, enabled-without-bucket failure, paired static credentials, RustFS endpoint/path-style configuration and TTL bounds.

- [ ] **Step 2: Run the environment tests and verify failure.**

Run: `npm test -- tests/config/env.test.ts --runInBand`

Expected: FAIL because review image variables are not parsed.

- [ ] **Step 3: Extend `src/config/env.ts`** with conditional Zod validation; keep access key/secret optional as a pair so production can use IAM/workload credentials.

- [ ] **Step 4: Install exact dependencies** with `npm install --save-exact @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp`; do not add `file-type` because Task 3 implements the three fixed magic-byte checks directly.

- [ ] **Step 5: Write failing adapter tests** asserting `putObject` sends `image/webp`, `deleteObject` is idempotent for missing keys, `objectExists` maps 404 to false, and `getSignedReadUrl` receives the configured TTL without exposing credentials.

- [ ] **Step 6: Implement the interface and S3 adapter** with these signatures:

```ts
export type PutReviewImageObject = { key: string; body: Buffer; contentLength: number };
export interface ReviewImageStorage {
  putObject(input: PutReviewImageObject): Promise<void>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
}
export const createReviewImageStorage: (config: Env) => ReviewImageStorage | null;
```

- [ ] **Step 7: Run focused tests.**

Run: `npm test -- tests/config/env.test.ts tests/lib/s3-review-image-storage.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add package.json package-lock.json .env.example src/config/env.ts src/lib/storage tests/config/env.test.ts tests/lib/s3-review-image-storage.test.ts
git commit -m "feat: add review image storage adapter"
```

### Task 2: RustFS local and integration-test infrastructure

**Files:**
- Modify: `docker-compose.yml`
- Modify: `tests/integration/setup-env.ts`
- Create: `tests/integration/review-image-storage.int.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createReviewImageStorage(config)` from Task 1.
- Produces: local RustFS S3 API on `localhost:9000`, console on `localhost:9001`, private bucket `laptopshop-review-images`; integration config uses a separate test bucket on port `9002`.

- [ ] **Step 1: Add the real-storage integration test** that puts a WebP fixture buffer, verifies `objectExists`, reads through a signed URL, deletes twice, then observes `false`.

- [ ] **Step 2: Run the test and verify infrastructure failure.**

Run: `npm run test:int -- tests/integration/review-image-storage.int.test.ts`

Expected: FAIL because RustFS/test variables are absent.

- [ ] **Step 3: Add `rustfs`, `rustfs-init` and `rustfs-test` Compose services** with healthchecks and idempotent private-bucket creation. Keep four RustFS data volumes; remove no existing product-image volume in this task.

- [ ] **Step 4: Set test-only storage variables** in `tests/integration/setup-env.ts`; document `docker compose --profile test up -d mysql-test rustfs-test rustfs-test-init` and local RustFS startup with non-production credentials.

- [ ] **Step 5: Run the integration test.**

Run: `npm run test:int -- tests/integration/review-image-storage.int.test.ts`

Expected: PASS with real RustFS.

- [ ] **Step 6: Commit.**

```bash
git add docker-compose.yml README.md tests/integration/setup-env.ts tests/integration/review-image-storage.int.test.ts
git commit -m "test: add rustfs review image runtime"
```

### Task 3: Image normalization pipeline

**Files:**
- Create: `src/modules/reviews/review-images.processor.ts`
- Test: `tests/modules/reviews/review-images.processor.test.ts`
- Test fixtures: `tests/fixtures/review-images/*`

**Interfaces:**
- Produces: `ProcessedReviewImage` and `processReviewImage(file): Promise<ProcessedReviewImage>`.
- Consumes no storage or Prisma dependency.

- [ ] **Step 1: Add failing processor tests** for valid JPEG/PNG/WebP, spoofed MIME, truncated data, 3 MB overflow, pixel overflow, EXIF orientation, metadata stripping, no upscale and maximum `1600 × 1600` output.

- [ ] **Step 2: Run the processor tests and verify failure.**

Run: `npm test -- tests/modules/reviews/review-images.processor.test.ts --runInBand`

Expected: FAIL because the processor does not exist.

- [ ] **Step 3: Implement fixed magic-byte detection and Sharp processing** with signatures:

```ts
export type ProcessedReviewImage = {
  buffer: Buffer;
  mimeType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
};
export const processReviewImage: (file: Express.Multer.File) => Promise<ProcessedReviewImage>;
```

Map expected failures to stable `AppError` codes from the spec; set Sharp input pixel limit before decode.

- [ ] **Step 4: Run the processor tests.**

Run: `npm test -- tests/modules/reviews/review-images.processor.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/modules/reviews/review-images.processor.ts tests/modules/reviews/review-images.processor.test.ts tests/fixtures/review-images
git commit -m "feat: normalize customer review images"
```

### Task 4: Review image schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261021100000_add_review_images/migration.sql`
- Modify: `tests/helpers/prisma.ts`
- Test: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Produces Prisma `ReviewImageStatus`, `ReviewImage` and `Review.images` relation with the exact fields/indexes in the spec.

- [ ] **Step 1: Add failing integration assertions** for review/image relations, unique `objectKey`, legal enum states and preservation under review moderation.

- [ ] **Step 2: Generate the migration against `mysql-test`**; add the enum/model/relations and inspect SQL for additive-only changes. Never use `db push` or reset a real database.

- [ ] **Step 3: Run Prisma generation and focused integration tests.**

Run: `npx prisma generate`

Run: `npm run test:int -- tests/integration/reviews.int.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add prisma tests/helpers/prisma.ts tests/integration/reviews.int.test.ts
git commit -m "feat: add review image lifecycle schema"
```

### Task 5: Transactional image lifecycle service

**Files:**
- Create: `src/modules/reviews/review-images.service.ts`
- Create: `src/modules/reviews/review-images.mapper.ts`
- Test: `tests/modules/reviews/review-images.service.test.ts`
- Test: `tests/integration/review-images.int.test.ts`

**Interfaces:**
- Consumes: `ReviewImageStorage`, `processReviewImage`, Prisma `ReviewImage`.
- Produces: `addReviewImages`, `reorderReviewImages`, `deleteReviewImage`, `toOwnerReviewImageDto`.

- [ ] **Step 1: Add failing service tests** for owner/non-owner/deleted review, hidden review access, three-image limit, all-or-none visibility, invalid reorder sets, idempotent delete and storage failure mapping.

- [ ] **Step 2: Add failing integration tests** where two users/request contexts race for one remaining slot and assert at most three `PENDING/READY` rows.

- [ ] **Step 3: Run tests and verify failure.**

Run: `npm test -- tests/modules/reviews/review-images.service.test.ts --runInBand`

Run: `npm run test:int -- tests/integration/review-images.int.test.ts`

Expected: FAIL because lifecycle functions do not exist.

- [ ] **Step 4: Implement service signatures.**

```ts
export type ReviewImageDeps = { storage: ReviewImageStorage; now?: () => Date };
export const addReviewImages: (deps: ReviewImageDeps, userId: number, reviewId: number, files: Express.Multer.File[]) => Promise<OwnerReviewImageDto[]>;
export const reorderReviewImages: (userId: number, reviewId: number, imageIds: number[]) => Promise<OwnerReviewImageDto[]>;
export const deleteReviewImage: (deps: ReviewImageDeps, userId: number, reviewId: number, imageId: number) => Promise<void>;
```

Use an interactive transaction and `SELECT ... FOR UPDATE` on the review before reserving rows. Generate keys as `reviews/{reviewId}/{uuid}.webp`; never use original filename.

- [ ] **Step 5: Run service and integration tests.**

Expected: PASS for both commands from Step 3.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/reviews/review-images.service.ts src/modules/reviews/review-images.mapper.ts tests/modules/reviews/review-images.service.test.ts tests/integration/review-images.int.test.ts
git commit -m "feat: manage review image lifecycle"
```

### Task 6: Image routes, limiter and OpenAPI contract

**Files:**
- Create: `src/modules/reviews/review-images.routes.ts`
- Create: `src/modules/reviews/review-images.authorization.ts`
- Modify: `src/modules/reviews/reviews.controller.ts`
- Modify: `src/modules/reviews/reviews.schema.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/app.ts`
- Modify: `src/server.ts`
- Modify: `src/middlewares/rate-limit.ts`
- Modify: `src/middlewares/error.middleware.ts`
- Modify: `src/docs/openapi.ts`
- Test: `tests/modules/reviews/review-images.routes.test.ts`
- Test: `tests/middlewares/error.middleware.test.ts`
- Test: `tests/docs/openapi.test.ts`

**Interfaces:**
- Consumes: lifecycle functions from Task 5.
- Produces route factory `createReviewImageRoutes(deps: ReviewImageDeps, limiter?: RequestHandler): Router` and the three endpoints from the spec.

- [ ] **Step 1: Add failing route tests** for auth and owner authorization before Multer consumes the body, multiple field files, size/file-count errors, owner 404 behavior, strict order body and `201/200/204` responses. Assert an unauthorized request never calls the processor or storage.

- [ ] **Step 2: Add failing limiter/error tests** asserting upload has a distinct Redis prefix/store and Multer size errors map to `413 REVIEW_IMAGE_TOO_LARGE` instead of generic `UPLOAD_ERROR`.

- [ ] **Step 3: Implement `requireReviewImageOwner` preflight middleware** that validates the active owner review from `req.auth.id` and `:id`, stores only the verified review ID in `res.locals`, and runs before Multer. The lifecycle service must recheck ownership/state inside its transaction to close the time-of-check/time-of-use window.

- [ ] **Step 4: Implement memory upload middleware** dedicated to review images and place route middleware in this order: `authenticate → validate params → requireReviewImageOwner → upload.array("images", 3) → controller`. Do not modify/reuse disk-based `src/middlewares/multer.ts` used by products/users.

- [ ] **Step 5: Wire injectable storage and route factory** through `AppDeps`, `createApiV1Router` and `server.ts`; when disabled, routes return a stable unavailable/not-found contract rather than creating a disk fallback.

- [ ] **Step 6: Register OpenAPI multipart/order/delete contracts and DTOs.**

- [ ] **Step 7: Run focused tests.**

Run: `npm test -- tests/modules/reviews/review-images.routes.test.ts tests/middlewares/error.middleware.test.ts tests/docs/openapi.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add src/app.ts src/server.ts src/routes/index.ts src/middlewares src/modules/reviews src/docs/openapi.ts tests/modules/reviews/review-images.routes.test.ts tests/middlewares/error.middleware.test.ts tests/docs/openapi.test.ts
git commit -m "feat: expose review image api"
```

### Task 7: Image-aware review DTOs and lifecycle cleanup

**Files:**
- Modify: `src/modules/reviews/reviews.mapper.ts`
- Modify: `src/modules/reviews/reviews.service.ts`
- Modify: `src/modules/reviews/reviews.controller.ts`
- Test: `tests/modules/reviews/reviews.mapper.test.ts`
- Test: `tests/modules/reviews/reviews.routes.test.ts`
- Test: `tests/modules/reviews/admin-reviews.routes.test.ts`
- Test: `tests/integration/reviews.int.test.ts`

**Interfaces:**
- Consumes: `ReviewImageStorage.getSignedReadUrl` and `READY` rows.
- Produces async public/owner/admin presenters returning `images: ReviewImageDto[]` without `objectKey`.

- [ ] **Step 1: Add failing mapper/presenter tests** for ordering, no private fields, URL signing only in public/owner/admin authorized contexts and no public signing after hide/delete.

- [ ] **Step 2: Add failing lifecycle tests** asserting customer delete marks images `DELETING`, removes them from DTO immediately and rewrite starts with no old images.

- [ ] **Step 3: Refactor review selects/presenters** to include only `READY` images and sign in service/presenter after authorization. Preserve existing author privacy and `contentUpdatedAt` semantics.

- [ ] **Step 4: Extend `deleteMyReview` transaction** to mark images `DELETING`; attempt storage cleanup after commit and leave retryable rows on failure.

- [ ] **Step 5: Run review unit and integration suites.**

Run: `npm test -- tests/modules/reviews --runInBand`

Run: `npm run test:int -- tests/integration/reviews.int.test.ts tests/integration/review-images.int.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/modules/reviews tests/modules/reviews tests/integration/reviews.int.test.ts tests/integration/review-images.int.test.ts
git commit -m "feat: include images in review lifecycle"
```

### Task 8: Storage reconciliation command

**Files:**
- Create: `src/scripts/reconcile-review-images.ts`
- Modify: `package.json`
- Test: `tests/scripts/reconcile-review-images.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `ReviewImageStorage.objectExists/deleteObject`.
- Produces: command `npm run review-images:reconcile` and `reconcileReviewImages(deps, cutoff): Promise<ReconcileResult>`.

- [ ] **Step 1: Add failing tests** for stale `PENDING`, retryable `DELETING`, repeated execution and missing object on `READY` producing an error report without silent data mutation.

- [ ] **Step 2: Implement the reconciliation function and CLI** with structured logger output and non-zero exit only for operational failures, not already-missing delete targets.

- [ ] **Step 3: Document manual and scheduled execution** for Docker deployment; do not invent a queue or require Redis.

- [ ] **Step 4: Run tests and a dry local invocation against RustFS.**

Run: `npm test -- tests/scripts/reconcile-review-images.test.ts --runInBand`

Run: `npm run review-images:reconcile`

Expected: tests PASS; command reports zero or processed rows without secrets.

- [ ] **Step 5: Commit.**

```bash
git add package.json src/scripts/reconcile-review-images.ts tests/scripts/reconcile-review-images.test.ts README.md
git commit -m "feat: reconcile review image storage"
```

### Task 9: Regenerate web contract and add image mutations

**Files:**
- Modify: `../laptopshop-web/src/lib/api/schema.d.ts`
- Modify: `../laptopshop-web/src/lib/api/types.ts`
- Modify: `../laptopshop-web/src/lib/api/query-keys.ts`
- Modify: `../laptopshop-web/src/lib/api/multipart.ts`
- Modify: `../laptopshop-web/src/features/reviews/hooks.ts`
- Modify: `../laptopshop-web/src/lib/api/errors.ts`
- Test: `../laptopshop-web/tests/lib/multipart.test.ts`
- Test: `../laptopshop-web/tests/features/reviews/hooks.test.tsx`

**Interfaces:**
- Consumes: generated image DTO/routes from Task 6.
- Produces: `useAddReviewImages`, `useReorderReviewImages`, `useDeleteReviewImage` and query invalidation under `queryKeys.reviews(productId)`.

- [ ] **Step 1: Start API with docs and regenerate types** using `npm run gen:api` in the web repo; inspect that multipart arrays and image DTOs are generated correctly.

- [ ] **Step 2: Add failing hook/multipart tests** for multiple files under field `images`, partial storage error propagation and review/eligibility invalidation.

- [ ] **Step 3: Extend multipart helper** with an array-capable API without changing existing product/avatar calls.

- [ ] **Step 4: Implement the three hooks** using generated request/response types and stable Vietnamese error messages.

- [ ] **Step 5: Run focused tests.**

Run from `../laptopshop-web`: `npm test -- tests/lib/multipart.test.ts tests/features/reviews/hooks.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit in the web repository.**

```bash
git add src/lib/api src/features/reviews/hooks.ts tests/lib/multipart.test.ts tests/features/reviews/hooks.test.tsx
git commit -m "feat: connect review image api"
```

### Task 10: Review form image manager and partial-success flow

**Files:**
- Create: `../laptopshop-web/src/features/reviews/ReviewImagesEditor/ReviewImagesEditor.tsx`
- Create: `../laptopshop-web/src/features/reviews/ReviewImagesEditor/ReviewImagesEditor.module.scss`
- Modify: `../laptopshop-web/src/features/reviews/ReviewForm/ReviewForm.tsx`
- Modify: `../laptopshop-web/src/features/reviews/ReviewForm/ReviewForm.module.scss`
- Modify: `../laptopshop-web/src/features/reviews/ReviewDialog/ReviewDialog.tsx`
- Test: `../laptopshop-web/tests/features/reviews/ReviewImagesEditor.test.tsx`
- Test: `../laptopshop-web/tests/features/reviews/ReviewForm.test.tsx`

**Interfaces:**
- Consumes: image hooks from Task 9 and `OwnerReview.images`.
- Produces editor state `{ existingIds: number[]; newFiles: File[] }`, preview cleanup and retryable `saveImages(reviewId)` orchestration.

- [ ] **Step 1: Add failing component tests** for preview, 0/3 counter, max limit, remove, left/right controls, URL revocation, hidden-review edit and 44px controls.

- [ ] **Step 2: Add failing dialog tests** asserting create-review success followed by upload failure leaves edit mode open, shows “Đánh giá đã được lưu nhưng ảnh chưa tải lên”, and retry uploads to the same review ID.

- [ ] **Step 3: Implement `ReviewImagesEditor`** with accessible file input and buttons; drag-and-drop may be added only after keyboard/button behavior passes.

- [ ] **Step 4: Extend ReviewForm/Dialog orchestration** to save JSON first, then delete/add/reorder images, and preserve the returned review as the retry target.

- [ ] **Step 5: Run focused tests and CSS lint.**

Run from `../laptopshop-web`: `npm test -- tests/features/reviews/ReviewImagesEditor.test.tsx tests/features/reviews/ReviewForm.test.tsx`

Run from `../laptopshop-web`: `npm run lint:css`

Expected: PASS.

- [ ] **Step 6: Commit in the web repository.**

```bash
git add src/features/reviews tests/features/reviews
git commit -m "feat: manage images in review form"
```

### Task 11: Public gallery, lightbox and admin evidence

**Files:**
- Create: `../laptopshop-web/src/features/reviews/ReviewGallery/ReviewGallery.tsx`
- Create: `../laptopshop-web/src/features/reviews/ReviewGallery/ReviewGallery.module.scss`
- Modify: `../laptopshop-web/src/features/reviews/ReviewCard/ReviewCard.tsx`
- Modify: `../laptopshop-web/src/features/reviews/ReviewCard/ReviewCard.module.scss`
- Modify: `../laptopshop-web/src/features/admin/reviews/ReviewDetail.tsx`
- Test: `../laptopshop-web/tests/features/reviews/ReviewGallery.test.tsx`
- Test: `../laptopshop-web/tests/features/reviews/ReviewSection.test.tsx`
- Test: `../laptopshop-web/tests/features/admin/ReviewDetail.test.tsx`
- Modify: `../laptopshop-web/e2e/storefront.spec.ts`

**Interfaces:**
- Consumes: `ReviewImageDto[]` from generated contracts.
- Produces: responsive gallery/lightbox shared by storefront and admin.

- [ ] **Step 1: Add failing gallery tests** for one/two/three layouts, explicit dimensions, lazy loading, keyboard-open/close, focus return and empty gallery.

- [ ] **Step 2: Implement the gallery** using existing Dialog primitives, SCSS tokens and signed URLs without long-lived client caching.

- [ ] **Step 3: Add gallery to ReviewCard and admin ReviewDetail**; do not expose admin/object metadata on storefront.

- [ ] **Step 4: Extend the existing Playwright review lifecycle** to upload a fixture, see it publicly/admin, hide the review, restore it, delete it and confirm rewrite starts without the old image.

- [ ] **Step 5: Run focused frontend tests.**

Run from `../laptopshop-web`: `npm test -- tests/features/reviews/ReviewGallery.test.tsx tests/features/reviews/ReviewSection.test.tsx tests/features/admin/ReviewDetail.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit in the web repository.**

```bash
git add src/features/reviews src/features/admin/reviews/ReviewDetail.tsx tests/features e2e/storefront.spec.ts
git commit -m "feat: display review image galleries"
```

### Task 12: Phase 4A full verification and operational handoff

**Files:**
- Modify if required by findings: API/web files already listed above
- Modify: `README.md`

**Interfaces:**
- Produces a releasable Phase 4A with documented RustFS/S3 setup and no known unverified core path.

- [ ] **Step 1: Run API gates** with MySQL and RustFS test services running.

Run: `npm run lint && npm run typecheck && npm test && npm run test:int`

Expected: PASS; record pre-existing warnings separately.

- [ ] **Step 2: Run web gates** with API docs and real API/RustFS available.

Run from `../laptopshop-web`: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && npm run e2e`

Expected: PASS.

- [ ] **Step 3: Execute manual smoke checks** at 320px and desktop widths: create with three images, reorder, retry a forced storage error, hide/restore, owner delete and reconciliation.

- [ ] **Step 4: Run `git diff --check` in both repositories** and inspect that no `.env`, credential, buffer fixture over repository limits or generated secret is staged.

- [ ] **Step 5: Commit only verification/documentation fixes** in their owning repository.

```bash
git commit -am "docs: document review image operations"
```
