# Inventory Core và phiếu nhập kho Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng Inventory Core có ledger bất biến, adjustment idempotent và phiếu nhập nhiều sản phẩm `DRAFT → POSTED` cho API Express/Prisma và Admin Portal Next.js.

**Architecture:** Giữ `products.quantity` làm tồn đọc nhanh và `stock_movements` làm audit ledger; mọi thay đổi tồn đi qua `moveStock()` trong Prisma transaction. Receipt là aggregate gồm header/items, post bằng conditional state transition và khóa product theo `productId` tăng dần; frontend dùng OpenAPI-generated types và TanStack Query.

**Tech Stack:** Express 5, TypeScript 5.7, Prisma 6.3, MySQL 8, Zod 3, Jest/Supertest; Next.js 16, React 19, Ant Design 6, TanStack Query 5, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-inventory-core-stock-receipts-design.md`

## Global Constraints

- Làm việc trên `feat/inventory-core-stock-receipts` cắt từ `develop` ở cả `laptopshop-api` và `laptopshop-web`; không sửa trực tiếp `main`.
- Không đọc `.env*` nếu chưa được người dùng cho phép; không đọc `process.env` ngoài `src/config/env.ts`, ngoại trừ test setup hiện có.
- Không thêm dependency, microservice, queue, event bus, supplier table, multi-warehouse, stocktake, reversal hoặc cost accounting.
- Dùng bare path aliases trong API; dùng `lib/logger.ts`, `AppError` với stable code và mapper DTO, không trả Prisma row.
- Mọi route `/api/v1` mới phải cập nhật `src/docs/openapi.ts` và `tests/docs/openapi.test.ts`.
- Admin inventory routes tiếp tục nằm sau `authenticate` + `requireRole("ADMIN")` trong router hiện có.
- Mọi stock mutation phải giữ `products.quantity = SUM(stock_movements.delta)` và chạy `npm run test:int` trên `mysql-test`.
- Frontend dùng copy tiếng Việt, Ant Design chỉ dưới `/admin`, `formatVnd`, query keys tập trung và generated OpenAPI types; không viết API DTO thủ công.
- Không deploy API, web hoặc migration thật trong plan này; rollout production là bước riêng cần quyền rõ ràng.
- Mỗi task dùng TDD: test đỏ → code tối thiểu → test xanh → commit nhỏ, không gộp commit giữa hai repository.

## Review Focus

- Hai item `productId: "01"` và `productId: 1` phải bị coi là trùng sau coercion, không chờ unique constraint gây lỗi 500; Task 3 có schema test cho trường hợp này.
- Cùng idempotency key với note chỉ khác whitespace phải được coi là cùng canonical payload; Task 5 có route/integration test cho replay này.
- `PATCH` receipt chạy đồng thời với `POST` phải tạo một trạng thái nhất quán: post dùng trọn bộ items trước hoặc sau patch, không dùng danh sách lai; Task 4 có integration race test.
- Backfill có nhiều movement cùng `createdAt` phải dùng `id` làm tie-breaker và tạo chuỗi balance xác định; Task 12 có migration integration test.
- Trình duyệt mất response rồi user retry phải dùng lại key, nhưng sửa payload phải sinh key mới; Task 11 có component test kiểm tra cả hai nhánh.

---

## File Structure

### `laptopshop-api`

- `prisma/schema.prisma`: receipt models, relations và movement metadata.
- `prisma/migrations/20261020173000_inventory_core_receipts_expand/migration.sql`: expand-only schema migration.
- `prisma/migrations/20261020193000_inventory_balance_contract/migration.sql`: deterministic balance backfill và non-null contract.
- `src/lib/idempotency.ts`: schema header và canonical SHA-256 helper dùng chung.
- `src/lib/prisma-retry.ts`: nhận diện `P2034` và retry bounded transaction.
- `src/modules/inventory/inventory.service.ts`: `moveStock()`, adjustment và movement queries.
- `src/modules/inventory/inventory.schema.ts`: adjustment/movement contracts.
- `src/modules/inventory/inventory.mapper.ts`: movement DTO/CSV relation data.
- `src/modules/inventory/inventory-receipts.schema.ts`: receipt status, params, query và bodies.
- `src/modules/inventory/inventory-receipts.mapper.ts`: summary/detail DTO selects và mappers.
- `src/modules/inventory/inventory-receipts.service.ts`: create/list/get/update/post receipt.
- `src/modules/inventory/inventory-receipts.controller.ts`: HTTP handlers receipt.
- `src/modules/inventory/inventory.routes.ts`: mount receipt routes và adjustment header behavior.
- `src/modules/inventory/inventory.reconciliation.ts`: read-only ledger mismatch query.
- `src/scripts/verify-stock-ledger.ts`: preflight CLI không sửa dữ liệu.
- `src/modules/products/products.service.ts`: cấm xóa product có movement.
- `src/docs/openapi.ts`: public contract.
- `tests/modules/inventory/*`, `tests/modules/products/admin-products.routes.test.ts`, `tests/integration/*`, `tests/docs/openapi.test.ts`: unit, route, integration và contract coverage.

### `laptopshop-web`

- `src/lib/api/schema.d.ts`, `src/lib/api/types.ts`, `src/lib/api/query-keys.ts`: generated contract, exports và cache keys.
- `src/features/admin/inventory/hooks.ts`: adjustment, movement và receipt hooks.
- `src/features/admin/inventory/InventoryNav.tsx`: điều hướng Nhật ký kho/Phiếu nhập.
- `src/features/admin/inventory/ReceiptList.tsx`: receipt list/filter/pagination.
- `src/features/admin/inventory/ReceiptForm.tsx`: create/edit draft form.
- `src/features/admin/inventory/ReceiptDetail.tsx`: draft edit, confirmation và posted read-only view.
- `src/features/admin/inventory/inventory.module.scss`: responsive table/card form styles.
- `src/features/admin/inventory/MovementList.tsx`, `StockAdjustModal.tsx`: movement balance/reference và retry-safe adjustment.
- `src/app/(admin)/admin/inventory/**/page.tsx`: list/new/detail routes.
- `tests/features/admin/*`, `e2e/admin.spec.ts`: component và real-API journey coverage.

---

### Task 1: Expand Prisma schema cho receipt và movement metadata

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261020173000_inventory_core_receipts_expand/migration.sql`
- Modify: `tests/integration/fixtures.ts`
- Create: `tests/integration/inventory-receipts.int.test.ts`

**Interfaces:**
- Consumes: `User`, `Product`, `StockMovement` models hiện có.
- Produces: Prisma models `StockReceipt`, `StockReceiptItem`; nullable `StockMovement.balanceBefore`, `balanceAfter`, `receiptId`, `idempotencyKey`, `requestHash`; compound unique `(actorId, idempotencyKey)`.

- [ ] **Step 1: Viết integration test đỏ cho constraints**

Trong `tests/integration/inventory-receipts.int.test.ts`, thêm test `enforces one product per receipt and restricts referenced product deletion`: tạo user/product/receipt, assert item trùng trả Prisma `P2002`, và xóa product đang được item tham chiếu trả `P2003`.

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm run test:int -- --runTestsByPath tests/integration/inventory-receipts.int.test.ts`
Expected: FAIL vì `prisma.stockReceipt`/schema chưa tồn tại.

- [ ] **Step 3: Thêm schema và expand migration**

Thêm đúng fields/relations/indexes trong spec; balance columns phải nullable ở migration này. Cập nhật `resetDb()` xóa `stockReceiptItem` rồi `stockReceipt` trước product/user.

- [ ] **Step 4: Generate client và xác nhận schema**

Run: `npx prisma format && npx prisma generate && npx prisma validate`
Expected: cả ba lệnh exit 0.

- [ ] **Step 5: Chạy integration test**

Run: `npm run test:int -- --runTestsByPath tests/integration/inventory-receipts.int.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261020173000_inventory_core_receipts_expand/migration.sql tests/integration/fixtures.ts tests/integration/inventory-receipts.int.test.ts
git commit -m "feat: add inventory receipt schema"
```

### Task 2: Ghi balance trong `moveStock()` và bảo vệ ledger khi xóa product

**Files:**
- Modify: `src/modules/inventory/inventory.service.ts:18-101`
- Modify: `src/modules/products/products.service.ts:114-129`
- Modify: `tests/modules/inventory/move-stock.test.ts`
- Modify: `tests/modules/products/admin-products.routes.test.ts`
- Modify: `tests/integration/fixtures.ts`
- Modify: `tests/integration/ledger.int.test.ts`

**Interfaces:**
- Consumes: nullable movement columns từ Task 1.
- Produces: `moveStock(tx: Prisma.TransactionClient, move: StockMove): Promise<StockMovement>` với optional `receiptId`, `idempotencyKey`, `requestHash`; mọi movement mới có balance.

- [ ] **Step 1: Viết unit tests đỏ cho balance và immutable delete**

Thêm tests:

- `moveStock writes balanceBefore and balanceAfter from the locked product row`: mock quantity sau update là 8 với delta 5, assert movement data có `balanceBefore: 3`, `balanceAfter: 8`.
- `deleteProduct refuses products with stock history`: mock movement count 1, assert HTTP 409 `PRODUCT_IN_USE` và không gọi `stockMovement.deleteMany`/`product.delete`.

- [ ] **Step 2: Chạy unit tests để xác nhận đỏ**

Run: `npx jest tests/modules/inventory/move-stock.test.ts tests/modules/products/admin-products.routes.test.ts --runInBand`
Expected: FAIL vì movement chưa có balance và delete vẫn xóa ledger.

- [ ] **Step 3: Mở rộng `StockMove` và `moveStock()`**

Sau atomic update, đọc `{ quantity }` trong cùng transaction; ghi `balanceAfter = quantity`, `balanceBefore = quantity - delta` cùng receipt/idempotency metadata. Không nhận balance từ caller.

- [ ] **Step 4: Bỏ delete ledger và kiểm tra lịch sử trước hard delete**

`deleteProduct(id)` đếm song song order details và movements; nếu một trong hai lớn hơn 0, throw `AppError(..., 409, "PRODUCT_IN_USE")`. Transaction xóa hợp lệ chỉ còn cart lines và product.

- [ ] **Step 5: Viết integration test đỏ/xanh cho chuỗi balance đồng thời**

Cập nhật fixture `OPENING` với `balanceBefore: 0`, `balanceAfter: quantity`. Thêm test `keeps balances contiguous across concurrent stock moves`: chạy hai transaction trên cùng product, sort movement `(createdAt,id)`, assert mỗi `balanceBefore` bằng balance trước đó và movement cuối bằng product quantity.

Run: `npm run test:int -- --runTestsByPath tests/integration/ledger.int.test.ts`
Expected: PASS và `ledgerMatches(product.id)` là `true`.

- [ ] **Step 6: Chạy unit regression**

Run: `npx jest tests/modules/inventory/move-stock.test.ts tests/modules/products/admin-products.routes.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/inventory/inventory.service.ts src/modules/products/products.service.ts tests/modules/inventory/move-stock.test.ts tests/modules/products/admin-products.routes.test.ts tests/integration/fixtures.ts tests/integration/ledger.int.test.ts
git commit -m "fix: preserve immutable stock ledger balances"
```

### Task 3: Thêm receipt draft CRUD

**Files:**
- Create: `src/modules/inventory/inventory-receipts.schema.ts`
- Create: `src/modules/inventory/inventory-receipts.mapper.ts`
- Create: `src/modules/inventory/inventory-receipts.service.ts`
- Create: `src/modules/inventory/inventory-receipts.controller.ts`
- Modify: `src/modules/inventory/inventory.routes.ts`
- Create: `tests/modules/inventory/inventory-receipts.schema.test.ts`
- Create: `tests/modules/inventory/inventory-receipts.routes.test.ts`

**Interfaces:**
- Consumes: `StockReceipt`/`StockReceiptItem` models từ Task 1, `pageArgs/pageMeta`, `createdAtRange`, `toActor`.
- Produces: `createReceipt(actorId, body)`, `listReceipts(query)`, `getReceipt(id)`, `updateReceipt(id, body)`; `toReceiptSummaryDto`, `toReceiptDetailDto`; schemas `receiptIdParams`, `listReceiptsQuery`, `createReceiptBody`, `updateReceiptBody`.

- [ ] **Step 1: Viết schema tests đỏ**

Assert:

- 0 và 101 items bị từ chối; 1–100 được nhận.
- `quantity` ngoài `1..10_000`, `unitCost` ngoài `0..2_000_000_000` bị từ chối.
- `supplierName` dài hơn 255 và `note` dài hơn 500 ký tự bị từ chối.
- `productId: "01"` và `productId: 1` bị coi là trùng sau coercion.
- PATCH rỗng bị từ chối; `items` khi xuất hiện vẫn phải có ít nhất một dòng.

- [ ] **Step 2: Chạy schema test để xác nhận đỏ**

Run: `npx jest tests/modules/inventory/inventory-receipts.schema.test.ts --runInBand`
Expected: FAIL vì schema file chưa tồn tại.

- [ ] **Step 3: Implement receipt schemas và code generator**

Export `RECEIPT_STATUS = { DRAFT, POSTED }`, types suy ra từ Zod, và pure helper `generateReceiptCode(now: Date, randomId: string): string` trả `PN-YYYYMMDD-XXXXXXXX` theo shop date.

- [ ] **Step 4: Viết route tests đỏ cho create/list/get/update**

Assert create trả 201, code do backend sinh, không gọi `stockMovement.create`; code collision `P2002` được sinh lại và không retry lỗi khác; list có pagination/filter; get map actor/product fields; PATCH thay toàn bộ items trong transaction; PATCH `POSTED` trả 409; USER trả 403.

- [ ] **Step 5: Implement mappers, services, controllers và routes**

Product validation dùng một `findMany` và trả `PRODUCT_UNAVAILABLE` với `productIds` thiếu/inactive. `updateReceipt()` conditional-lock receipt ở `DRAFT` trước khi replace items. Code collision `P2002` được retry tối đa ba lần, lỗi khác không retry. Log create/update chỉ gồm receipt ID/code, actor ID, item count và duration; không log body, note hoặc unit cost.

- [ ] **Step 6: Chạy tests**

Run: `npx jest tests/modules/inventory/inventory-receipts.schema.test.ts tests/modules/inventory/inventory-receipts.routes.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/inventory/inventory-receipts.* src/modules/inventory/inventory.routes.ts tests/modules/inventory/inventory-receipts.schema.test.ts tests/modules/inventory/inventory-receipts.routes.test.ts
git commit -m "feat: add stock receipt drafts"
```

### Task 4: Post receipt atomically và xử lý transaction conflicts

**Files:**
- Create: `src/lib/prisma-retry.ts`
- Modify: `src/modules/inventory/inventory-receipts.service.ts`
- Modify: `src/modules/inventory/inventory-receipts.controller.ts`
- Modify: `tests/modules/inventory/inventory-receipts.routes.test.ts`
- Modify: `tests/integration/inventory-receipts.int.test.ts`
- Create: `tests/lib/prisma-retry.test.ts`

**Interfaces:**
- Consumes: `moveStock()` từ Task 2 và receipt DTO từ Task 3.
- Produces: `withPrismaTransactionRetry<T>(operation: () => Promise<T>, maxAttempts?: number): Promise<T>`; `postReceipt(id: string, actorId: number): Promise<{ receipt: StockReceiptDetailDto; movements: MovementDto[]; created: boolean }>`.

- [ ] **Step 1: Viết retry helper tests đỏ**

Assert `P2034` thất bại hai lần rồi thành công ở lần ba; validation/AppError chỉ chạy một lần; quá ba lần rethrow lỗi cuối.

- [ ] **Step 2: Implement retry helper tối thiểu**

Retry chỉ Prisma `P2034`, tối đa ba attempts, jitter nhỏ injectable trong test; không retry mọi exception.

- [ ] **Step 3: Viết receipt post route tests đỏ**

Assert lần đầu trả 200 `created: true`; receipt đã `POSTED` trả 200 `created: false` và không gọi `moveStock`; missing trả 404; empty trả 400; product inactive trả 409; structured log chỉ chứa receipt/actor/item/movement/duration metadata.

- [ ] **Step 4: Implement `postReceipt()`**

Claim `DRAFT → POSTED` trước, đọc items theo `productId asc`, revalidate active products, gọi `moveStock()` với `receiptId`, `RESTOCK`, `onlyActive: true`, rồi map receipt/movements. Toàn bộ nằm trong callback được `withPrismaTransactionRetry()` bao quanh; mỗi retry/final result log category nhưng không log payload.

- [ ] **Step 5: Viết integration concurrency tests**

Thêm:

- `posts one receipt exactly once under concurrent requests`.
- `rolls back status products and movements when one item becomes inactive`.
- `serializes patch against post without mixing item sets`: kết quả cuối `POSTED`, item lưu và delta movements phải là toàn bộ version cũ hoặc toàn bộ version mới.

- [ ] **Step 6: Chạy integration tests**

Run: `npm run test:int -- --runTestsByPath tests/integration/inventory-receipts.int.test.ts`
Expected: PASS; quantity chỉ tăng một lần và ledger khớp.

- [ ] **Step 7: Commit**

```bash
git add src/lib/prisma-retry.ts src/modules/inventory/inventory-receipts.service.ts src/modules/inventory/inventory-receipts.controller.ts tests/lib/prisma-retry.test.ts tests/modules/inventory/inventory-receipts.routes.test.ts tests/integration/inventory-receipts.int.test.ts
git commit -m "feat: post stock receipts atomically"
```

### Task 5: Làm adjustment idempotent trong giai đoạn chuyển tiếp

**Files:**
- Create: `src/lib/idempotency.ts`
- Modify: `src/modules/orders/orders.schema.ts`
- Modify: `src/modules/orders/orders.controller.ts`
- Modify: `src/modules/payments/payments.controller.ts`
- Modify: `src/modules/inventory/inventory.schema.ts`
- Modify: `src/modules/inventory/inventory.service.ts:70-101`
- Modify: `src/modules/inventory/inventory.controller.ts:10-12`
- Modify: `tests/modules/inventory/inventory.routes.test.ts`
- Modify: `tests/integration/ledger.int.test.ts`
- Create: `tests/lib/idempotency.test.ts`

**Interfaces:**
- Consumes: movement unique key từ Task 1 và balance-aware `moveStock()` từ Task 2.
- Produces: `idempotencyKeyHeader`, `sha256Canonical(fields: readonly unknown[]): string`; `adjustStock(actorId: number, key: string | undefined, body: AdjustmentBody): Promise<{ product: ProductDto; movement: MovementDto; created: boolean }>`.

- [ ] **Step 1: Viết helper/schema tests đỏ**

Assert key trim `1..64`; canonical hash ổn định với field order cố định; adjustment bắt buộc note cho cả `RESTOCK` và `CORRECTION`.

- [ ] **Step 2: Tách helper dùng chung**

Di chuyển `idempotencyKeyHeader` khỏi order schema sang `lib/idempotency.ts`; cập nhật order/payment imports mà không đổi behavior hiện có.

- [ ] **Step 3: Viết adjustment replay tests đỏ**

Assert:

- key mới trả 201 và `created: true`;
- cùng key/body trả 200 và `created: false`;
- note khác whitespace sau Zod trim vẫn replay;
- cùng key/delta khác trả 409 `IDEMPOTENCY_KEY_REUSED`;
- thiếu key trong transition vẫn xử lý một lần và gọi `logger.warn({ category: "missing_idempotency_key" }, ...)`.
- created/replayed/conflict log đúng category và không chứa note.

- [ ] **Step 4: Implement idempotency transaction flow**

Hash tuple `[productId, delta, reason, note]`. Check existing trước mutation; ghi key/hash cùng movement; catch `P2002` ngoài transaction, fetch winner và so hash. Không tạo custom response cache.

- [ ] **Step 5: Viết integration race test**

Hai `adjustStock(admin.id, "same-key", sameBody)` đồng thời phải đều fulfill, chỉ một kết quả `created: true`, chỉ một movement và quantity chỉ đổi một lần. Cùng key khác body phải có một rejected 409 và ledger vẫn khớp.

- [ ] **Step 6: Chạy tests**

Run: `npx jest tests/lib/idempotency.test.ts tests/modules/inventory/inventory.routes.test.ts tests/modules/orders/orders.routes.test.ts tests/modules/payments/payments.routes.test.ts --runInBand`
Run: `npm run test:int -- --runTestsByPath tests/integration/ledger.int.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/idempotency.ts src/modules/orders/orders.schema.ts src/modules/orders/orders.controller.ts src/modules/payments/payments.controller.ts src/modules/inventory/inventory.schema.ts src/modules/inventory/inventory.service.ts src/modules/inventory/inventory.controller.ts tests/lib/idempotency.test.ts tests/modules/inventory/inventory.routes.test.ts tests/integration/ledger.int.test.ts
git commit -m "feat: make stock adjustments idempotent"
```

### Task 6: Hoàn thiện movement DTO, CSV và OpenAPI chuyển tiếp

**Files:**
- Modify: `src/modules/inventory/inventory.mapper.ts`
- Modify: `src/modules/inventory/inventory.service.ts:103-156`
- Modify: `src/docs/openapi.ts`
- Modify: `tests/modules/inventory/inventory.routes.test.ts`
- Modify: `tests/docs/openapi.test.ts`

**Interfaces:**
- Consumes: receipt routes/DTO từ Tasks 3–4 và adjustment từ Task 5.
- Produces: OpenAPI cho receipt endpoints; movement fields `balanceBefore`, `balanceAfter`, `receiptId`, `receiptCode`; transitional optional `Idempotency-Key` header; helper `op()` hỗ trợ thêm success response 200/201.

- [ ] **Step 1: Viết route/CSV tests đỏ**

Movement response phải có balance và receipt code; CSV headers phải thêm “Tồn trước”, “Tồn sau”, “Phiếu nhập”; order link fields vẫn giữ nguyên.

- [ ] **Step 2: Mở rộng include, mapper và CSV**

`movementInclude` select receipt code; `toMovementDto()` map nullable balance trong transition; CSV dùng cùng row include.

- [ ] **Step 3: Viết OpenAPI tests đỏ**

Assert năm receipt paths, schemas summary/detail/item, adjustment responses 200/201, header `Idempotency-Key`, movement balance/reference fields và errors 400/403/404/409.

- [ ] **Step 4: Implement OpenAPI contract**

Header được mô tả optional ở checkpoint chuyển tiếp; ghi description rằng nó sẽ bắt buộc sau Admin UI rollout. Mở rộng type `Op` bằng `additionalOk?: Array<[status: number, description: string, schema?: z.ZodTypeAny]>` để adjustment tài liệu hóa cả 201 created và 200 replay. Dùng Zod schemas từ module, không lặp validation shape nếu có thể import.

- [ ] **Step 5: Chạy API checkpoint**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int && git diff --check`
Expected: tất cả exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/inventory/inventory.mapper.ts src/modules/inventory/inventory.service.ts src/docs/openapi.ts tests/modules/inventory/inventory.routes.test.ts tests/docs/openapi.test.ts
git commit -m "docs: publish stock receipt api contract"
```

### Task 7: Đồng bộ Web contract, hooks và Inventory navigation

**Files:**
- Modify: `src/lib/api/schema.d.ts`
- Modify: `src/lib/api/types.ts`
- Modify: `src/lib/api/query-keys.ts`
- Modify: `src/features/admin/inventory/hooks.ts`
- Create: `src/features/admin/inventory/InventoryNav.tsx`
- Modify: `src/features/admin/inventory/MovementList.tsx`
- Modify: `src/app/(admin)/admin/inventory/page.tsx`
- Modify: `tests/features/admin/MovementList.test.tsx`
- Create: `tests/features/admin/InventoryNav.test.tsx`

**Interfaces:**
- Consumes: OpenAPI checkpoint từ Task 6.
- Produces: generated `StockReceiptSummary`/`StockReceiptDetail` types; query keys `adminReceipts(query)`, `adminReceipt(id)`; hooks cho list/get/create/update/post; shared `InventoryNav`.

- [ ] **Step 1: Chuẩn bị web feature branch**

Trong `laptopshop-web`, cập nhật `develop` rồi tạo `feat/inventory-core-stock-receipts`. Không copy uncommitted files từ API repo.

- [ ] **Step 2: Regenerate API types**

Chạy API với `ENABLE_DOCS=true`, sau đó trong web run `npm run gen:api`. Export receipt types từ `src/lib/api/types.ts`.

- [ ] **Step 3: Viết hook/navigation tests đỏ**

Assert receipt hooks gọi đúng path/params và mutations invalidate `queryKeys.adminAll`; `InventoryNav` có hai link active đúng route; MovementList hiển thị balance và link receipt khi có.

- [ ] **Step 4: Implement keys, hooks, nav và movement columns**

Giữ `/admin/inventory?productId=...` hoạt động. Không tạo refresh/session path mới. Link trong `InventoryNav` có hit area tối thiểu 44px trên mobile.

- [ ] **Step 5: Chạy tests**

Run: `npm test -- --run tests/features/admin/MovementList.test.tsx tests/features/admin/InventoryNav.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit trong web repo**

```bash
git add src/lib/api/schema.d.ts src/lib/api/types.ts src/lib/api/query-keys.ts src/features/admin/inventory/hooks.ts src/features/admin/inventory/InventoryNav.tsx src/features/admin/inventory/MovementList.tsx 'src/app/(admin)/admin/inventory/page.tsx' tests/features/admin/MovementList.test.tsx tests/features/admin/InventoryNav.test.tsx
git commit -m "feat: add inventory receipt client contract"
```

### Task 8: Xây dựng danh sách phiếu nhập

**Files:**
- Create: `src/features/admin/inventory/ReceiptList.tsx`
- Create: `src/features/admin/inventory/inventory.module.scss`
- Create: `src/app/(admin)/admin/inventory/receipts/page.tsx`
- Create: `tests/features/admin/ReceiptList.test.tsx`

**Interfaces:**
- Consumes: `useReceipts()` và `InventoryNav` từ Task 7.
- Produces: receipt list UI với status/date/code filters và pagination URL state.

- [ ] **Step 1: Viết component test đỏ**

Mock response hai receipts; assert code link, supplier, item count, total quantity, status tag, date filter query và pagination. Empty/error/loading states phải có copy tiếng Việt.

- [ ] **Step 2: Implement ReceiptList và route**

Dùng `useListParams`, AntD Table/Tag/DatePicker/Input; table có `scroll={{ x: "max-content" }}`. Style chỉ trong SCSS module và token/mixin hiện có.

- [ ] **Step 3: Chạy test và style lint**

Run: `npm test -- --run tests/features/admin/ReceiptList.test.tsx && npm run lint:css`
Expected: PASS.

- [ ] **Step 4: Commit trong web repo**

```bash
git add src/features/admin/inventory/ReceiptList.tsx src/features/admin/inventory/inventory.module.scss 'src/app/(admin)/admin/inventory/receipts/page.tsx' tests/features/admin/ReceiptList.test.tsx
git commit -m "feat: add stock receipt list"
```

### Task 9: Tạo form receipt responsive

**Files:**
- Create: `src/features/admin/inventory/ReceiptForm.tsx`
- Modify: `src/features/admin/inventory/inventory.module.scss`
- Create: `src/app/(admin)/admin/inventory/receipts/new/page.tsx`
- Create: `tests/features/admin/ReceiptForm.test.tsx`

**Interfaces:**
- Consumes: generated create body, admin product list query và `useCreateReceipt()`.
- Produces: `ReceiptForm({ initialValue?, onSubmit, submitting })` dùng được cho create và edit; new receipt page.

- [ ] **Step 1: Viết form tests đỏ**

Assert thêm/xóa dòng, không cho product trùng, quantity/unitCost validation, tổng số dòng/số lượng/giá trị qua `formatVnd`, submit payload trim, và giữ form khi server trả lỗi.

- [ ] **Step 2: Implement desktop table và mobile card layout**

Dùng cùng `Form.List` state; CSS media query chỉ đổi presentation, không render hai form độc lập. Product Select tìm từ admin products API và disable IDs đã chọn.

- [ ] **Step 3: Implement new page flow**

Create thành công hiện “Đã lưu phiếu nhập” và route tới `/admin/inventory/receipts/{id}`; lỗi dùng `setServerErrors` + `errorMessage`.

- [ ] **Step 4: Chạy tests**

Run: `npm test -- --run tests/features/admin/ReceiptForm.test.tsx && npm run lint:css`
Expected: PASS.

- [ ] **Step 5: Commit trong web repo**

```bash
git add src/features/admin/inventory/ReceiptForm.tsx src/features/admin/inventory/inventory.module.scss 'src/app/(admin)/admin/inventory/receipts/new/page.tsx' tests/features/admin/ReceiptForm.test.tsx
git commit -m "feat: add stock receipt form"
```

### Task 10: Xây dựng receipt detail, edit và post flow

**Files:**
- Create: `src/features/admin/inventory/ReceiptDetail.tsx`
- Create: `src/app/(admin)/admin/inventory/receipts/[id]/page.tsx`
- Create: `tests/features/admin/ReceiptDetail.test.tsx`

**Interfaces:**
- Consumes: `ReceiptForm`, receipt detail hooks và generated post response.
- Produces: draft edit/post UI và posted read-only detail.

- [ ] **Step 1: Viết detail tests đỏ**

Assert:

- DRAFT render form và “Xác nhận nhập kho”.
- Confirmation modal nêu đúng số dòng/tổng số lượng.
- POSTED không có input/nút post, hiển thị người/thời điểm xác nhận.
- `INVALID_RECEIPT_STATUS` refresh detail và chuyển read-only.
- `PRODUCT_UNAVAILABLE` hiển thị lỗi trên item tương ứng.
- Post replay `created: false` vẫn hiển thị thành công nhưng không nhân đôi toast.

- [ ] **Step 2: Implement ReceiptDetail và dynamic route**

Route param là UUID string; loading/404/error states dùng AntD Result/Alert hiện có. Update thành công giữ cùng route; post thành công invalidate admin queries.

- [ ] **Step 3: Chạy tests**

Run: `npm test -- --run tests/features/admin/ReceiptDetail.test.tsx tests/features/admin/ReceiptForm.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit trong web repo**

```bash
git add src/features/admin/inventory/ReceiptDetail.tsx 'src/app/(admin)/admin/inventory/receipts/[id]/page.tsx' tests/features/admin/ReceiptDetail.test.tsx
git commit -m "feat: add stock receipt posting ui"
```

### Task 11: Gửi và giữ `Idempotency-Key` trong StockAdjustModal

**Files:**
- Modify: `src/features/admin/inventory/hooks.ts`
- Modify: `src/features/admin/inventory/StockAdjustModal.tsx`
- Modify: `tests/features/admin/StockAdjustModal.test.tsx`
- Create: `tests/features/admin/inventory-hooks.test.tsx`

**Interfaces:**
- Consumes: transitional adjustment OpenAPI từ Task 6.
- Produces: `useAdjustStock()` nhận `{ body: AdjustBody; idempotencyKey: string }` và gửi header; modal giữ key theo canonical payload.

- [ ] **Step 1: Viết hook test đỏ**

Assert Request có `Idempotency-Key` đúng giá trị và body không chứa key.

- [ ] **Step 2: Viết modal retry tests đỏ**

Mock lần đầu network reject, lần hai success; assert hai requests dùng cùng key. Sau lỗi, sửa delta/note rồi submit; assert request mới dùng key khác. Assert note bắt buộc cho cả RESTOCK và CORRECTION.

- [ ] **Step 3: Implement key lifecycle**

Canonical payload phía UI gồm `productId`, `delta`, `reason`, trimmed note. Giữ `{ fingerprint, key }` trong ref; reuse nếu fingerprint giống, thay bằng `crypto.randomUUID()` nếu khác; clear sau success.

- [ ] **Step 4: Chạy tests**

Run: `npm test -- --run tests/features/admin/StockAdjustModal.test.tsx tests/features/admin/inventory-hooks.test.tsx`
Expected: PASS.

- [ ] **Step 5: Chạy web checkpoint**

Run: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && git diff --check`
Expected: tất cả exit 0.

- [ ] **Step 6: Commit trong web repo**

```bash
git add src/features/admin/inventory/hooks.ts src/features/admin/inventory/StockAdjustModal.tsx tests/features/admin/StockAdjustModal.test.tsx tests/features/admin/inventory-hooks.test.tsx
git commit -m "feat: make stock adjustment retries safe"
```

### Task 12: Backfill/contract migration và bắt buộc idempotency header

**Files:**
- Create: `src/modules/inventory/inventory.reconciliation.ts`
- Create: `src/scripts/verify-stock-ledger.ts`
- Modify: `package.json`
- Create: `prisma/migrations/20261020193000_inventory_balance_contract/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/inventory/inventory.controller.ts`
- Modify: `src/docs/openapi.ts`
- Create: `tests/modules/inventory/inventory.reconciliation.test.ts`
- Modify: `tests/modules/inventory/inventory.routes.test.ts`
- Modify: `tests/docs/openapi.test.ts`
- Modify: `tests/integration/inventory-receipts.int.test.ts`
- Create: `tests/integration/inventory-balance-migration.int.test.ts`

**Interfaces:**
- Consumes: mọi movement mới có balance từ Task 2 và web đã gửi key từ Task 11.
- Produces: `findLedgerMismatches(): Promise<LedgerMismatch[]>`; script `npm run inventory:verify-ledger`; non-null balances; required adjustment header.

- [ ] **Step 1: Viết reconciliation tests đỏ**

Assert query trả product có `quantity !== SUM(delta)`, không trả product khớp và không sửa dữ liệu. CLI exit code 1 khi có mismatch, 0 khi sạch.

- [ ] **Step 2: Implement read-only verifier**

Thêm package script `inventory:verify-ledger`; script import Prisma client/config/logger hiện có, không đọc `process.env` trực tiếp và luôn disconnect trong `finally`.

- [ ] **Step 3: Viết migration test cho deterministic backfill**

Trong `tests/integration/inventory-balance-migration.int.test.ts`, tạo ba movement cùng `createdAt` với balance placeholder. Đọc chính migration SQL, thực thi đoạn nằm giữa marker `-- BACKFILL_START` và `-- BACKFILL_END` trên `mysql-test`, rồi assert running balance dùng `id` làm tie-breaker và final balance bằng product quantity. Test không thực thi lại câu `ALTER ... NOT NULL`.

- [ ] **Step 4: Tạo contract migration**

Migration dùng window `SUM(delta) OVER (PARTITION BY productId ORDER BY createdAt, id)` trong derived table, update hai balance columns, rồi `ALTER ... NOT NULL`. Migration không thay `products.quantity` và không tự chèn movement.

- [ ] **Step 5: Bắt buộc header và cập nhật OpenAPI**

Controller dùng `idempotencyKeyHeader.parse(req.get("idempotency-key"))`; xóa compatibility warning/path thiếu key. OpenAPI mark header required; route/docs tests assert missing header trả 400.

- [ ] **Step 6: Chạy preflight và backend suite**

Run trên `mysql-test`: `NODE_ENV=test DATABASE_URL=mysql://root:test@127.0.0.1:3307/laptopshop_test JWT_SECRET=test-jwt-secret-0123456789 npm run inventory:verify-ledger`
Run: `npm run lint && npm run typecheck && npm test && npm run test:int && git diff --check`
Expected: verifier báo không có mismatch; toàn bộ suite exit 0.

- [ ] **Step 7: Commit trong API repo**

```bash
git add src/modules/inventory/inventory.reconciliation.ts src/scripts/verify-stock-ledger.ts package.json prisma/schema.prisma prisma/migrations/20261020193000_inventory_balance_contract/migration.sql src/modules/inventory/inventory.controller.ts src/docs/openapi.ts tests/modules/inventory/inventory.reconciliation.test.ts tests/modules/inventory/inventory.routes.test.ts tests/docs/openapi.test.ts tests/integration/inventory-receipts.int.test.ts tests/integration/inventory-balance-migration.int.test.ts
git commit -m "feat: enforce inventory ledger contract"
```

### Task 13: Regenerate final Web contract và kiểm tra E2E

**Files:**
- Modify: `src/lib/api/schema.d.ts`
- Modify: `src/features/admin/inventory/hooks.ts` nếu generated required header thay đổi call signature
- Modify: `e2e/admin.spec.ts`

**Interfaces:**
- Consumes: final required-header OpenAPI từ Task 12 và toàn bộ Admin UI Tasks 7–11.
- Produces: final generated contract và real-API receipt journey.

- [ ] **Step 1: Regenerate final API types**

Run API với docs từ Task 12 rồi chạy `npm run gen:api` trong web. Sửa hook call chỉ khi TypeScript yêu cầu; không cast bỏ qua required header.

- [ ] **Step 2: Viết E2E receipt journey**

Trong `e2e/admin.spec.ts`, admin tạo product, mở receipt mới, nhập supplier/note/item, lưu draft, sửa quantity, post, rồi assert detail `POSTED`, product quantity tăng đúng một lần và movement có receipt code/balance.

- [ ] **Step 3: Chạy E2E với API thật**

Khởi động `mysql-test`, API `:8080` với database test/seed phù hợp và web `:3000`; không đọc hoặc log secret.
Run: `npm run e2e -- --grep "stock receipt"`
Expected: PASS.

- [ ] **Step 4: Chạy full Web suite**

Run: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && npm run e2e && git diff --check`
Expected: tất cả exit 0.

- [ ] **Step 5: Commit trong web repo**

```bash
git add src/lib/api/schema.d.ts src/features/admin/inventory/hooks.ts e2e/admin.spec.ts
git commit -m "test: cover stock receipt journey"
```

### Task 14: Final cross-repository verification và handoff

**Files:**
- Verify only; chỉ sửa file nếu verification phát hiện regression trong scope.

**Interfaces:**
- Consumes: final heads của hai feature branches.
- Produces: evidence bundle gồm commit SHAs, command outputs, migration order và các giới hạn chưa triển khai.

- [ ] **Step 1: Kiểm tra working trees và diff scope**

Run trong mỗi repo: `git status --short --branch`, `git diff develop...HEAD --stat`, `git diff --check develop...HEAD`.
Expected: chỉ file trong plan thay đổi; working tree sạch.

- [ ] **Step 2: Chạy lại API verification bắt buộc**

Run: `npm run lint && npm run typecheck && npm test && npm run test:int`
Expected: tất cả PASS; ghi số test suites/tests.

- [ ] **Step 3: Chạy lại Web verification bắt buộc**

Run: `npm run lint && npm run lint:css && npm run typecheck && npm test && npm run build && npm run e2e`
Expected: tất cả PASS; ghi số test suites/tests và Playwright cases.

- [ ] **Step 4: Review thủ công các bất biến**

Xác nhận từ diff/tests: không còn `stockMovement.deleteMany` trong product delete; mọi `moveStock()` path ghi balance; receipt post sort product ID; required idempotency header xuất hiện trong OpenAPI và web request; không có API delete/reverse receipt.

- [ ] **Step 5: Ghi handoff, không deploy**

Báo cáo hai branch/commit heads, migration order `expand → API transition → Web → contract`, verification evidence và các mục ngoài phạm vi. Không push/merge/deploy nếu chưa có quyền tương ứng tại thời điểm thực thi.
