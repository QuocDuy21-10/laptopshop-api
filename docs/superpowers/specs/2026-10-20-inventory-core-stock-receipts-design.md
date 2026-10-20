# Inventory Core và phiếu nhập kho: thiết kế

Ngày: 2026-10-20
Branch: `feat/inventory-core-stock-receipts` (cắt từ `develop`)
Nguồn: `docs-local/plan/quan-ly-ton-kho.md`

## 1. Mục tiêu

Mở rộng module Inventory hiện có thành nền tảng quản lý nhập kho có thể truy vết, an toàn khi retry và an toàn khi có nhiều giao dịch đồng thời. Lát cắt đầu tiên gồm hai phần gắn chặt với nhau:

1. **Inventory Core**: bảo vệ ledger, idempotency cho điều chỉnh thủ công, lưu tồn trước/sau và ngăn xóa lịch sử.
2. **Phiếu nhập kho**: tạo bản nháp nhiều sản phẩm và xác nhận nhập bằng một transaction all-or-nothing.

Tính năng phải đạt các kết quả sau:

- `products.quantity` tiếp tục là số tồn khả dụng tối ưu cho catalog và checkout.
- `stock_movements` là ledger bất biến và luôn giải thích được mọi thay đổi tồn mới.
- Retry adjustment hoặc post receipt không cộng tồn hai lần.
- Phiếu nhiều sản phẩm hoặc được ghi toàn bộ, hoặc rollback toàn bộ.
- Checkout, cancel, payment expiry và AI advisor không thay đổi hành vi.
- Admin Portal có luồng tạo, sửa, xem và xác nhận phiếu nhập bằng tiếng Việt, dùng Ant Design hiện có.

## 2. Hiện trạng đã kiểm chứng

Backend đã có nền phù hợp để mở rộng:

- `moveStock()` là điểm dùng chung để cập nhật `products.quantity` và tạo `stock_movements` trong transaction của caller.
- Checkout trừ kho bằng conditional update, xử lý sản phẩm theo `productId` tăng dần và có integration tests với MySQL thật.
- Cancel hoàn kho trong cùng transaction với chuyển trạng thái.
- Migration `20261019095518_stock_movements` đã tạo movement `OPENING`, nên `SUM(delta) = quantity` có điểm bắt đầu rõ ràng.
- Admin API đã có adjustment, movement list và CSV export.
- Admin Portal đã có `StockAdjustModal` và `MovementList`.

Các khoảng trống cần sửa trong lát cắt này:

- `deleteProduct()` đang xóa toàn bộ movement nếu sản phẩm chưa có order.
- Adjustment chưa có idempotency key; retry có thể cộng hoặc trừ tồn hai lần.
- Movement chưa lưu `balanceBefore` và `balanceAfter`.
- Chưa có chứng từ gom nhiều sản phẩm và chưa có trạng thái `DRAFT → POSTED`.
- Frontend chỉ nhập `delta`, chưa có luồng tạo phiếu nhập.

## 3. Quyết định kiến trúc

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Kiến trúc | Mở rộng modular monolith hiện tại | Giữ transaction nội bộ MySQL; không tạo distributed consistency |
| Nguồn đọc tồn nhanh | `products.quantity` | Catalog và checkout không phải tính tổng ledger |
| Nguồn audit | `stock_movements` bất biến | Có thể truy vết, đối chiếu và điều tra sai lệch |
| Điểm ghi tồn | Chỉ qua `moveStock()` | Tập trung bất biến quantity + movement |
| Chứng từ nhập | `stock_receipts` + `stock_receipt_items` | Mô hình quan hệ rõ ràng, hỗ trợ nhiều sản phẩm |
| Nhà cung cấp MVP | `supplierName` dạng text | Chưa có nghiệp vụ công nợ hoặc purchase order để cần bảng Supplier |
| Giá nhập | `unitCost` VND nguyên, nullable | Lưu được dữ liệu nếu có nhưng chưa mở rộng sang giá vốn |
| Trạng thái phiếu | `DRAFT`, `POSTED` | Đủ cho MVP; reversal thuộc phase sau |
| Idempotency adjustment | Header + request hash + unique constraint | Phân biệt replay hợp lệ với tái sử dụng key sai payload |
| Idempotency post receipt | Conditional state transition | Receipt ID và trạng thái là khóa nghiệp vụ tự nhiên |
| Thứ tự khóa product | `productId` tăng dần | Đồng nhất với checkout, giảm nguy cơ deadlock |
| Kiểu status | `String` + hằng số TypeScript | Theo convention status hiện tại của project |

Không dùng ledger làm nguồn đọc duy nhất, không tách microservice, không thêm event bus, Redis queue hoặc database thứ hai.

## 4. Bất biến nghiệp vụ

Sau khi rollout hoàn tất, hệ thống phải bảo vệ các bất biến sau:

1. `products.quantity = SUM(stock_movements.delta)` cho từng sản phẩm.
2. `products.quantity` không âm.
3. Mỗi lần thay đổi quantity phải có đúng một movement tương ứng cho mỗi sản phẩm.
4. Không tạo movement nếu cập nhật product thất bại.
5. `balanceAfter = balanceBefore + delta`.
6. Movement của cùng sản phẩm tạo thành chuỗi liên tục: balance sau của movement trước bằng balance trước của movement sau.
7. Một adjustment idempotency key chỉ đại diện cho một payload chuẩn hóa.
8. Một receipt chỉ được chuyển từ `DRAFT` sang `POSTED` một lần.
9. Receipt `POSTED` và movement không được sửa hoặc xóa.
10. Product đã có movement chỉ được ngừng kinh doanh bằng `isActive = false`, không được xóa cứng.

Các bất biến 1–6 nằm trong transaction của `moveStock()`. Các bất biến 7–10 được bảo vệ bằng unique constraint, conditional update, foreign key và service rules.

## 5. Mô hình dữ liệu

### 5.1 `Product`

Giữ nguyên `quantity` và quan hệ hiện có, bổ sung quan hệ receipt item:

```prisma
model Product {
  // Các trường và quan hệ hiện có
  receiptItems StockReceiptItem[]
}
```

`lowStockThreshold`, `stockVersion` và stocktake thuộc phase vận hành kho sau, không thêm trong lát cắt này.

### 5.2 `StockReceipt`

```prisma
model StockReceipt {
  id           String   @id @default(uuid()) @db.Char(36)
  code         String   @unique @db.VarChar(40)
  supplierName String?  @db.VarChar(255)
  status       String   @default("DRAFT") @db.VarChar(20)
  note         String?  @db.VarChar(500)
  createdAt    DateTime @default(now())
  postedAt     DateTime?

  createdBy   User @relation("ReceiptCreator", fields: [createdById], references: [id])
  createdById Int
  postedBy    User? @relation("ReceiptPoster", fields: [postedById], references: [id])
  postedById  Int?

  items     StockReceiptItem[]
  movements StockMovement[]

  @@index([status, createdAt])
  @@index([createdById, createdAt])
  @@map("stock_receipts")
}
```

`code` do backend sinh theo dạng `PN-YYYYMMDD-XXXXXXXX`, trong đó ngày dùng múi giờ cửa hàng và hậu tố là tám ký tự đầu của UUID viết hoa. Unique constraint là lớp bảo vệ cuối; nếu va chạm, service sinh lại tối đa ba lần. Mã phiếu bất biến sau khi tạo và không phải idempotency key.

Quan hệ ngược được đặt tên rõ trên `User`:

```prisma
stockReceiptsCreated StockReceipt[] @relation("ReceiptCreator")
stockReceiptsPosted  StockReceipt[] @relation("ReceiptPoster")
```

### 5.3 `StockReceiptItem`

```prisma
model StockReceiptItem {
  id        Int @id @default(autoincrement())
  receiptId String @db.Char(36)
  productId Int
  quantity  Int
  unitCost  Int?

  receipt StockReceipt @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@unique([receiptId, productId])
  @@index([productId])
  @@map("stock_receipt_items")
}
```

Zod và service bảo đảm `quantity` là số nguyên từ 1 đến 10.000, `unitCost` là số nguyên từ 0 đến 2.000.000.000 VND và một receipt có tối đa 100 items. Cascade chỉ hỗ trợ thao tác nội bộ với draft trong tương lai; MVP không công bố API delete receipt. Receipt `POSTED` không bao giờ đi vào delete path.

### 5.4 Mở rộng `StockMovement`

```prisma
model StockMovement {
  // Các trường và quan hệ hiện có
  balanceBefore Int
  balanceAfter  Int

  receipt   StockReceipt? @relation(fields: [receiptId], references: [id], onDelete: Restrict)
  receiptId String? @db.Char(36)

  idempotencyKey String? @db.VarChar(64)
  requestHash    String? @db.Char(64)

  @@unique([actorId, idempotencyKey])
  @@index([receiptId])
}
```

`idempotencyKey` và `requestHash` chỉ có giá trị trên movement của adjustment thủ công. Movement từ order, cancel, product initial stock và receipt để hai trường này là `null`. Adjustment luôn có `actorId`, nên quy tắc MySQL cho nullable compound unique không làm mất bảo vệ idempotency.

Trong giai đoạn expand, `balanceBefore` và `balanceAfter` được tạo nullable để tương thích dữ liệu và tiến trình cũ. Chỉ sau backfill và verify chúng mới chuyển sang non-null như schema đích ở trên.

### 5.5 Delete behavior

- `Product → StockMovement`: giữ `ON DELETE RESTRICT` hiện tại.
- `Product → StockReceiptItem`: `ON DELETE RESTRICT`.
- `StockReceipt → StockReceiptItem`: `ON DELETE CASCADE`, chỉ hữu ích với draft nếu bổ sung delete sau này.
- `StockReceipt → StockMovement`: `ON DELETE RESTRICT`.
- `deleteProduct()` kiểm tra cả order và movement. Nếu đã có lịch sử, trả `409 PRODUCT_IN_USE` và không gọi `stockMovement.deleteMany()`.
- Product chưa có order hoặc movement vẫn có thể xóa; cart line được dọn như hiện tại.

## 6. `moveStock()` và transaction boundary

`moveStock()` tiếp tục nhận `Prisma.TransactionClient`; không tự mở transaction. Caller chịu trách nhiệm gom toàn bộ nghiệp vụ trong một transaction.

Input mở rộng:

```ts
type StockMove = {
  productId: number;
  delta: number;
  reason: StockReason;
  orderId?: number;
  receiptId?: string;
  actorId?: number;
  note?: string;
  idempotencyKey?: string;
  requestHash?: string;
  onlyActive?: boolean;
};
```

Trình tự:

1. Với `delta < 0`, dùng conditional `updateMany` để từ chối tồn âm và áp dụng `onlyActive` khi caller yêu cầu.
2. Với `delta > 0`, update quantity nguyên tử; receipt dùng `onlyActive: true`, adjustment correction có thể sửa product inactive để xử lý audit.
3. Đọc quantity mới trong cùng transaction, khi update lock vẫn còn hiệu lực.
4. Tính `balanceAfter = product.quantity` và `balanceBefore = balanceAfter - delta`.
5. Tạo movement với các reference và idempotency metadata tương ứng.

Không dùng quantity do frontend gửi làm balance. Không tính lại quantity bằng `SUM(delta)` trên catalog path.

Caller xử lý nhiều sản phẩm phải sort theo `productId` tăng dần trước khi gọi `moveStock()` để dùng cùng thứ tự khóa với checkout.

## 7. Điều chỉnh kho thủ công

### 7.1 Contract

```http
POST /api/v1/admin/inventory/adjustments
Idempotency-Key: <1-64 ký tự>
Content-Type: application/json
```

Body giữ shape hiện tại:

```json
{
  "productId": 1,
  "delta": 5,
  "reason": "RESTOCK",
  "note": "Nhập nhanh theo biên bản PN giấy số 42"
}
```

Quy tắc mới:

- `Idempotency-Key` bắt buộc sau giai đoạn contract.
- `RESTOCK` chỉ nhận delta dương.
- `CORRECTION` nhận delta dương hoặc âm nhưng không nhận 0.
- Cả hai reason đều bắt buộc `note` sau khi trim.
- Header được parse bằng schema idempotency hiện có của order; không tự đọc header trong service.

Payload chuẩn hóa trước khi hash:

```ts
{
  productId,
  delta,
  reason,
  note: note.trim(),
}
```

`requestHash` là SHA-256 của JSON canonical theo thứ tự field cố định trên.

### 7.2 Idempotency flow

1. Tìm movement theo `(actorId, idempotencyKey)`.
2. Nếu có và hash giống: không thay đổi stock; trả movement cũ, product hiện tại và `created: false` với HTTP 200.
3. Nếu có và hash khác: trả `409 IDEMPOTENCY_KEY_REUSED`.
4. Nếu chưa có: gọi `moveStock()` trong transaction và trả `created: true` với HTTP 201.
5. Nếu hai request cùng thắng bước kiểm tra ban đầu, unique constraint làm một transaction rollback. Caller bắt lỗi unique, đọc winner, so hash và trả theo bước 2 hoặc 3.

Product trong replay phản ánh trạng thái hiện tại tại thời điểm response; movement và `balanceAfter` phản ánh kết quả ổn định của thao tác gốc.

## 8. Phiếu nhập kho

### 8.1 API

Mọi endpoint nằm dưới admin router hiện có, sau `authenticate` và `requireRole("ADMIN")`:

| Method | Endpoint | Mục đích |
|---|---|---|
| `GET` | `/api/v1/admin/inventory/receipts` | Danh sách phân trang, lọc status/ngày, tìm mã |
| `POST` | `/api/v1/admin/inventory/receipts` | Tạo receipt `DRAFT` |
| `GET` | `/api/v1/admin/inventory/receipts/:id` | Chi tiết receipt và items |
| `PATCH` | `/api/v1/admin/inventory/receipts/:id` | Sửa receipt `DRAFT` |
| `POST` | `/api/v1/admin/inventory/receipts/:id/post` | Xác nhận nhập kho |

Không có API delete hoặc reverse trong MVP.

### 8.2 Tạo draft

Request:

```json
{
  "supplierName": "Nhà cung cấp ABC",
  "note": "Nhập hàng đợt tháng 10",
  "items": [
    { "productId": 1, "quantity": 5, "unitCost": 18500000 },
    { "productId": 2, "quantity": 3, "unitCost": 14000000 }
  ]
}
```

Service:

1. Zod kiểm tra 1–100 items, không trùng `productId`, quantity và unit cost trong giới hạn.
2. Truy vấn toàn bộ product trong một lần và xác minh tất cả tồn tại, `isActive: true`.
3. Sinh `code` ở backend.
4. Tạo receipt và items trong một transaction.
5. Không gọi `moveStock()`, không thay đổi quantity và không tạo movement.

Response HTTP 201 qua `StockReceiptDto`; không trả Prisma row.

### 8.3 Sửa draft

`PATCH` cho phép cập nhật `supplierName`, `note` và `items`. Khi có `items`, danh sách mới thay toàn bộ danh sách cũ trong transaction.

Transaction phải conditional theo `status: DRAFT`. Nó khóa receipt row trước khi xóa/tạo lại items, để không race với thao tác post. Nếu receipt không còn `DRAFT`, trả `409 INVALID_RECEIPT_STATUS`.

Product được kiểm tra lại giống lúc create. Response HTTP 200 trả receipt mới nhất.

### 8.4 Post receipt

`POST /receipts/:id/post` dùng receipt ID và conditional state transition làm idempotency tự nhiên:

1. Mở interactive transaction.
2. Claim bằng `updateMany({ where: { id, status: "DRAFT" }, data: { status: "POSTED", postedById, postedAt } })`.
3. Nếu claim thất bại, đọc receipt:
   - Không tồn tại: `404 NOT_FOUND`.
   - Đã `POSTED`: trả receipt hiện tại, không thay đổi stock, `created: false`, HTTP 200.
   - Trạng thái khác trong tương lai: `409 INVALID_RECEIPT_STATUS`.
4. Đọc items theo `productId` tăng dần; phiếu rỗng trả `400 EMPTY_RECEIPT` và transaction rollback.
5. Kiểm tra lại mọi product vẫn tồn tại và active. Nếu không, trả `409 PRODUCT_UNAVAILABLE` kèm `productIds`; transaction rollback về `DRAFT`.
6. Với từng item, gọi `moveStock()` bằng `reason: RESTOCK`, `receiptId`, `actorId` và `onlyActive: true`.
7. Đọc receipt DTO và các movement vừa tạo trước khi commit.
8. Trả `created: true`, HTTP 200.

Nếu bất kỳ item nào lỗi, status, quantity và mọi movement trong receipt đều rollback. Không có trạng thái `POSTING` vì transaction và conditional claim đã cung cấp atomicity cần thiết.

Deadlock/transaction conflict có thể retry được sẽ được retry tối đa ba lần với jitter ngắn ở service boundary. Retry dùng cùng receipt ID hoặc idempotency context, log bằng `lib/logger.ts` và không retry validation, unique payload conflict hoặc lỗi nghiệp vụ.

## 9. DTO, mapper và lỗi

### 9.1 Mapper

`inventory.mapper.ts` mở rộng và tách mapper rõ ràng:

- `toMovementDto`: thêm `balanceBefore`, `balanceAfter`, `receiptId`, `receiptCode`.
- `toReceiptSummaryDto`: dùng cho list.
- `toReceiptDetailDto`: header, actor, items và thông tin product cần hiển thị.
- Product trong receipt item chỉ select `id`, `name`, `image`, `isActive`; không trả nguyên Prisma row.

CSV movement bổ sung các cột “Tồn trước”, “Tồn sau” và “Phiếu nhập”.

### 9.2 Error contract

| HTTP | Code | Trường hợp |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Body, query, params hoặc header không hợp lệ |
| 400 | `EMPTY_RECEIPT` | Receipt không có item khi post |
| 403 | `FORBIDDEN` | User thường gọi admin inventory API |
| 404 | `NOT_FOUND` | Receipt hoặc product không tồn tại |
| 409 | `PRODUCT_IN_USE` | Xóa product đã có order hoặc movement |
| 409 | `PRODUCT_UNAVAILABLE` | Product bị inactive trước khi post |
| 409 | `INVALID_RECEIPT_STATUS` | Sửa hoặc post receipt ở trạng thái không hợp lệ |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Cùng key, khác request hash |
| 409 | `OUT_OF_STOCK` | Correction âm vượt tồn hiện có |

Expected errors dùng `AppError` với code ổn định. Unexpected/retryable transaction errors được log bằng `lib/logger.ts`; không dùng `console`.

## 10. OpenAPI

`src/docs/openapi.ts` bổ sung:

- `StockReceiptSummary`, `StockReceiptDetail`, `StockReceiptItem`.
- Query list receipt: `page`, `pageSize`, `status`, `q`, `from`, `to`.
- Create/patch receipt body và post response.
- Adjustment header `Idempotency-Key`, response 200 replay và 201 created.
- Movement fields mới và receipt relation.
- Error responses 400, 403, 404 và 409 tương ứng.

`tests/docs/openapi.test.ts` xác minh path, method, header bắt buộc, response status và schema quan trọng. Sau khi API ổn định, frontend chạy `npm run gen:api`; không viết type contract thủ công.

## 11. Admin Portal (`laptopshop-web`)

### 11.1 Routes và điều hướng

Giữ `/admin/inventory` là Nhật ký kho để không phá link hiện có `/admin/inventory?productId=...`.

Bổ sung:

| Route | Nội dung |
|---|---|
| `/admin/inventory/receipts` | Danh sách receipt |
| `/admin/inventory/receipts/new` | Form tạo draft |
| `/admin/inventory/receipts/[id]` | Chi tiết, sửa draft hoặc post |

Các trang có navigation nội bộ “Nhật ký kho / Phiếu nhập”. Inventory Overview và Stocktake không nằm trong lát cắt này.

### 11.2 Form receipt

- Dùng Ant Design `Form`, `Form.List`, `Select`, `InputNumber`, `Table`, `Card`, `Statistic`, `Tag` và `Modal` hiện có.
- Desktop hiển thị items dạng table; mobile chuyển thành card stack để tránh form dài theo chiều ngang.
- Mỗi item có product, quantity, unit cost và thành tiền trình bày.
- Không cho chọn trùng product; server vẫn validate độc lập.
- Hiển thị tổng số dòng, tổng số lượng và tổng giá trị tham khảo.
- Submit tạo draft rồi chuyển tới trang chi tiết.
- `DRAFT` cho sửa và post; `POSTED` chỉ đọc.
- Modal post hiển thị số dòng và tổng số lượng trước khi xác nhận.

### 11.3 Adjustment retry

`StockAdjustModal` bắt buộc note và sinh key bằng `crypto.randomUUID()` khi submit.

- Key được giữ cùng payload sau lỗi mạng hoặc 5xx chưa rõ kết quả.
- “Thử lại” dùng lại key cũ.
- Khi user sửa bất kỳ field nào, key cũ bị bỏ và lần submit sau sinh key mới.
- Thành công thì đóng modal và xóa local key.
- UI hiển thị tồn hiện tại và tồn dự kiến; backend không tin giá trị dự kiến này.

### 11.4 Query và trạng thái lỗi

- Query keys mới nằm trong `src/lib/api/query-keys.ts`.
- Hooks nằm trong `src/features/admin/inventory/hooks.ts` hoặc các file nhỏ hơn nếu file vượt một trách nhiệm.
- Create/update/post thành công invalidate receipt list/detail, movement list, products và dashboard qua namespace admin hiện có.
- `VALIDATION_ERROR` gắn đúng field hoặc item.
- `PRODUCT_UNAVAILABLE` đánh dấu item tương ứng.
- `INVALID_RECEIPT_STATUS` refresh detail và chuyển UI sang read-only.
- `IDEMPOTENCY_KEY_REUSED` không retry tự động; UI yêu cầu tạo thao tác mới.
- Lỗi mạng/5xx giữ nguyên form để retry.

Mọi copy là tiếng Việt, giá dùng `formatVnd`, màu sắc theo Ant Design theme admin và không cài thêm thư viện UI.

## 12. Migration và rollout

Rollout dùng expand–migrate–contract để API và web có thể phát hành riêng:

### 12.1 Preflight

Trước migration, chạy đối chiếu read-only cho từng product:

```text
products.quantity == COALESCE(SUM(stock_movements.delta), 0)
```

Nếu có sai lệch, dừng rollout và điều tra; không tự động sửa quantity hoặc chèn movement giả.

### 12.2 Expand

- Tạo `stock_receipts` và `stock_receipt_items`.
- Thêm `receiptId`, `idempotencyKey`, `requestHash`, `balanceBefore`, `balanceAfter` vào movement.
- Hai balance tạm thời nullable.
- Thêm indexes, unique constraint và foreign keys.
- Migration được tạo và thử trên compose service `mysql-test`; không dùng `prisma migrate reset` hoặc `db push` với database thật.

### 12.3 Deploy API chuyển tiếp

- API ghi balance và idempotency metadata cho movement mới.
- Receipt API hoạt động.
- Adjustment tạm chấp nhận thiếu key để Admin UI cũ không bị vỡ, nhưng ghi warning category `missing_idempotency_key`.
- Request có key đã nhận đầy đủ bảo vệ idempotency.

### 12.4 Backfill và verify

- Tính running balance theo từng product, thứ tự `(createdAt, id)`.
- Điền `balanceAfter = cumulative SUM(delta)` và `balanceBefore = balanceAfter - delta`.
- Chạy lại đối chiếu ledger, kiểm tra không còn balance null và chạy integration suite.

### 12.5 Deploy web và contract

- Deploy web có adjustment key và receipt UI.
- Regenerate/commit OpenAPI types.
- Sau khi web mới hoạt động, API bắt buộc `Idempotency-Key`.
- Migration contract đổi hai balance thành non-null.

Public storefront không phụ thuộc receipt API. Cửa sổ chuyển tiếp chỉ ảnh hưởng mức bảo vệ retry của Admin adjustment cũ, không ảnh hưởng checkout.

## 13. Kiểm thử

### 13.1 Backend unit và route tests

- Adjustment mới trả 201, replay trả 200 và không gọi update lần hai.
- Cùng key khác body trả `IDEMPOTENCY_KEY_REUSED`.
- RESTOCK âm, delta 0, thiếu note hoặc thiếu key sau contract trả 400.
- Receipt create validate item trùng, empty, quá 100 dòng, quantity và unit cost.
- User thường bị từ chối mọi receipt endpoint.
- PATCH chỉ sửa `DRAFT`; `POSTED` trả 409.
- Product inactive tại create/post trả lỗi đúng contract.
- Mapper không trả Prisma row và movement có balance/receipt code.
- OpenAPI chứa đủ route, schema và header.

### 13.2 Backend integration tests với MySQL

1. Hai request post cùng receipt chỉ tăng tồn một lần.
2. Hai adjustment đồng thời cùng key chỉ tạo một movement.
3. Cùng key khác payload không thay đổi tồn của request thua.
4. Một item lỗi làm rollback status, mọi product và mọi movement.
5. Balance của các movement cùng product tạo chuỗi liên tục.
6. Checkout và receipt đồng thời không làm âm tồn, mất movement hoặc lệch ledger.
7. Checkout, cancel, quick restock và receipt kết thúc với `quantity = SUM(delta)`.
8. Xóa product có movement trả 409 và ledger còn nguyên.
9. Retry transaction conflict không tạo movement trùng.
10. Backfill kết thúc không có balance null và final balance khớp quantity.

Theo `AGENTS.md`, mọi thay đổi stock phải chạy real-MySQL integration suite.

### 13.3 Frontend tests

- Form thêm/xóa item, chặn product trùng và giữ dữ liệu khi lỗi.
- DRAFT editable, POSTED read-only.
- Confirmation modal hiển thị đúng tổng item/quantity.
- Adjustment giữ nguyên key khi retry cùng payload và đổi key khi payload thay đổi.
- Hooks gọi đúng generated contract và invalidate đúng admin queries.
- E2E với API thật: tạo draft → sửa → post → thấy movement và quantity mới.
- Kiểm tra form/table ở desktop và mobile.

### 13.4 Lệnh xác nhận

API:

```bash
npm run lint
npm run typecheck
npm test
npm run test:int
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

## 14. Quan sát vận hành

Log có cấu trúc cho các sự kiện:

- adjustment created/replayed/conflict;
- receipt created/updated/posted/replayed;
- transaction retry và lỗi cuối;
- request thiếu idempotency key trong rollout chuyển tiếp.

Log chỉ chứa `receiptId`, `receiptCode`, `actorId`, số items, số movements, duration và error category. Không log toàn bộ request, note hoặc unit cost. Không thêm metrics backend mới trong MVP; log hiện có đủ để điều tra.

## 15. Ngoài phạm vi

- Inventory Overview và low-stock threshold theo product.
- Stocktake bằng counted quantity hoặc stock version.
- Supplier master data, purchase order và công nợ.
- Reversal receipt, returns và hoàn hàng sau vận chuyển.
- Giá vốn, valuation, FIFO/average cost.
- Public reconciliation endpoint và tự động sửa chênh lệch.
- Multi-warehouse, stock location, reservation hoặc transfer.
- Thông báo tồn thấp.

Các phần này chỉ bắt đầu sau khi core và receipt đã ổn định.

## 16. Tiêu chí hoàn thành

- Không còn code path xóa stock ledger.
- Mọi movement mới có balance trước/sau và giữ đúng chuỗi balance.
- Adjustment retry-safe; reuse key sai payload bị từ chối.
- Receipt nhiều sản phẩm post all-or-nothing và post lặp không tăng tồn lần hai.
- Receipt `POSTED` bất biến và mọi movement liên kết được tới order hoặc receipt khi có chứng từ.
- API, OpenAPI và generated frontend types đồng bộ.
- Admin Portal hoàn thành create, edit, post và xem receipt trên desktop/mobile.
- Ledger reconciliation vượt qua sau migration và sau integration scenarios.
- Toàn bộ lệnh xác nhận API, integration, web và E2E đều pass.
- Không thay đổi hành vi checkout, cancel, payment expiry, catalog hoặc AI advisor.
