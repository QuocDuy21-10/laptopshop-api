# Thiết kế Phase 4 — Nâng cấp đánh giá sản phẩm

Ngày: 2026-10-21

Phạm vi: `laptopshop-api` và `laptopshop-web`

Trạng thái: Đã được duyệt

Spec nền: `docs/superpowers/specs/2026-10-21-product-reviews-design.md`

## 1. Mục tiêu

Mở rộng hệ thống Verified Purchase Reviews đã hoàn thành ở Phase 1–3 bằng bốn khả năng:

1. khách hàng thêm tối đa ba ảnh thực tế vào review;
2. người dùng đăng nhập đánh dấu review hữu ích;
3. cửa hàng phản hồi chính thức cho review;
4. storefront hiển thị rating trên `ProductCard`, lọc theo rating tối thiểu và sắp xếp theo rating cao nhất.

Phase 4 phải giữ nguyên các invariant hiện có: backend quyết định eligibility và ownership, review chỉ công khai khi `status = PUBLISHED AND deletedAt IS NULL`, review bị ẩn không tự được khôi phục khi khách sửa, public DTO không làm lộ danh tính hoặc bằng chứng mua hàng.

Thiết kế ưu tiên tính đúng và khả năng vận hành production. Hệ thống vẫn là modular monolith Express + Prisma + MySQL; không thêm microservice, Redis cache hay message queue.

## 2. Tiêu chí thành công

- Local và CI dùng MinIO qua cùng S3-compatible adapter với production.
- API không ghi ảnh review vào `public/` hoặc phụ thuộc upload volume của container Express.
- File do khách tải lên được xác minh nội dung thực, loại metadata và chuẩn hoá trước khi lưu.
- Khách có thể thêm, xoá và sắp xếp lại ảnh khi sửa review.
- Helpful vote idempotent, chống duplicate và không cho tác giả tự vote.
- Mỗi review có tối đa một phản hồi chính thức, có audit admin nhưng không lộ danh tính admin trên storefront.
- Rating card, filter và sort dùng cùng một định nghĩa review công khai, không N+1 và không có counter denormalized dễ lệch.
- OpenAPI và generated client đồng bộ giữa hai repository.
- Unit, route, integration, frontend và E2E tests bao phủ các lifecycle mới.

## 3. Phạm vi và thứ tự triển khai

Phase 4 được chia thành bốn sub-project có thể release độc lập:

### 3.1. Phase 4A — Review images

- storage abstraction tương thích S3;
- MinIO cho local và integration tests;
- upload, chuẩn hoá, đọc, xoá và reconciliation;
- UI preview, retry, xoá, reorder và gallery/lightbox;
- admin xem ảnh của review công khai hoặc bị ẩn.

### 3.2. Phase 4B — Helpful votes

- helpful/unhelpful idempotent;
- count công khai;
- batch viewer state cho người dùng đăng nhập;
- optimistic UI có rollback.

### 3.3. Phase 4C — Official reply

- admin tạo, sửa và xoá mềm một phản hồi chính thức;
- storefront hiển thị nhãn LaptopShop;
- admin identity chỉ phục vụ audit.

### 3.4. Phase 4D — Catalog rating

- rating và review count trên `ProductCard`;
- filter `minRating = 3 | 4`;
- sort `rating_desc`;
- facet counts nhất quán với các filter khác.

Thứ tự mặc định là `4A → 4B → 4C → 4D`. Mỗi sub-project có migration, API contract, generated client và tests riêng; không gộp toàn bộ vào một migration hoặc một commit lớn.

## 4. Ngoài phạm vi

- video trong review;
- upload trực tiếp từ browser bằng presigned write URL;
- ảnh HEIC/HEIF;
- người dùng chưa đăng nhập vote;
- nhiều loại reaction hoặc dislike;
- thread trao đổi giữa admin và khách;
- nhiều official reply cho một review;
- sort rating tăng dần;
- Bayesian rating, weighted rating hoặc chống review bombing nâng cao;
- CDN riêng, image transformation service hoặc moderation ảnh bằng AI;
- Redis cache, materialized aggregate table hoặc counter lưu trên `Product`.

## 5. Kiến trúc tổng thể

### 5.1. Ranh giới module

`modules/reviews` tiếp tục sở hữu review lifecycle, ownership, moderation, images, helpful votes và official reply. Controller chỉ xử lý HTTP; service giữ nghiệp vụ; schema parse input; mapper/presenter tạo DTO tường minh.

Storage nằm sau interface riêng trong `lib/storage/`. Review service không import trực tiếp MinIO hoặc AWS SDK implementation.

```text
Storefront/Admin
       │
       ▼
Express review routes
       │
       ├── Review service ── Prisma/MySQL
       │
       └── ReviewImageStorage ── S3 API ── MinIO local / object storage production
```

Interface storage tối thiểu hỗ trợ:

```ts
type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: "image/webp";
  contentLength: number;
};

interface ReviewImageStorage {
  putObject(input: PutObjectInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
}
```

Không đưa bucket credentials, raw object key hoặc original filename vào public DTO.

### 5.2. Vì sao upload đi qua API

Mỗi review chỉ có tối đa ba ảnh nhỏ. Upload qua API cho phép xác minh authentication và ownership trước khi decode ảnh, dùng một pipeline kiểm tra thống nhất và tránh state machine phức tạp của presigned direct upload. Direct upload chỉ được cân nhắc lại khi có số liệu tải hoặc kích thước file chứng minh cần thiết.

### 5.3. Private object storage

Bucket ảnh review luôn private. Service chỉ ký read URL cho:

- public review đang `PUBLISHED` và chưa xoá;
- owner đang đọc/sửa review của chính mình, kể cả review `HIDDEN`;
- admin đang xem review detail.

Presigned URL mặc định có TTL 900 giây. Review bị ẩn hoặc xoá không nhận URL mới; URL đã phát hành có thể còn hiệu lực đến hết TTL. Đây là giới hạn nhất quán được chấp nhận thay vì đưa toàn bộ media traffic qua Express.

## 6. Cấu hình storage và MinIO local

Mọi biến môi trường được parse duy nhất trong `src/config/env.ts`:

```text
REVIEW_IMAGES_ENABLED
REVIEW_IMAGE_S3_ENDPOINT
REVIEW_IMAGE_S3_REGION
REVIEW_IMAGE_S3_BUCKET
REVIEW_IMAGE_S3_ACCESS_KEY_ID
REVIEW_IMAGE_S3_SECRET_ACCESS_KEY
REVIEW_IMAGE_S3_FORCE_PATH_STYLE
REVIEW_IMAGE_URL_TTL_SECONDS
```

Quy tắc validation:

- khi `REVIEW_IMAGES_ENABLED=true`, region và bucket là bắt buộc;
- access key và secret phải cùng có hoặc cùng vắng;
- local MinIO yêu cầu endpoint, credentials và `FORCE_PATH_STYLE=true`;
- production có thể bỏ credentials tĩnh để AWS SDK dùng workload/IAM credentials;
- TTL có giới hạn an toàn, mặc định 900 giây;
- secret không được log hoặc trả qua health endpoints.

Docker Compose thêm MinIO API, console và healthcheck. Có thể dùng volume `minio-data` để dữ liệu MinIO tồn tại qua restart; đây là storage nội bộ của MinIO, không phải upload volume được mount vào container Express. Một init container hoặc script idempotent tạo private bucket và policy cần thiết.

`.env.example` chỉ chứa placeholder, không chứa credential thật.

## 7. Mô hình dữ liệu

### 7.1. Review images

```prisma
enum ReviewImageStatus {
  PENDING
  READY
  DELETING
}

model ReviewImage {
  id               Int               @id @default(autoincrement())
  reviewId         Int
  objectKey        String            @unique @db.VarChar(512)
  mimeType         String            @db.VarChar(50)
  byteSize         Int
  width            Int
  height           Int
  position         Int               @db.UnsignedTinyInt
  status           ReviewImageStatus @default(PENDING)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  deletedAt        DateTime?
  storageDeletedAt DateTime?

  review Review @relation(fields: [reviewId], references: [id], onDelete: Restrict)

  @@index([reviewId, status, position])
  @@index([status, updatedAt])
  @@map("review_images")
}
```

Không đặt unique constraint trên `(reviewId, position)` để reorder không gặp xung đột tạm thời. Service khoá review row, xác minh toàn bộ tập image IDs và ghi position liên tục từ 0. Giới hạn ba ảnh được bảo vệ trong transaction bằng cách đếm cả `PENDING` và `READY` chưa xoá.

### 7.2. Helpful votes

```prisma
model ReviewHelpful {
  reviewId Int
  userId   Int
  createdAt DateTime @default(now())

  review Review @relation(fields: [reviewId], references: [id], onDelete: Restrict)
  user   User   @relation(fields: [userId], references: [id], onDelete: Restrict)

  @@id([reviewId, userId])
  @@index([userId, createdAt])
  @@map("review_helpful")
}
```

Composite primary key là bảo vệ cuối cùng trước duplicate và request đồng thời. Không lưu `helpfulCount` trên review.

### 7.3. Official reply

```prisma
model ReviewReply {
  id          Int       @id @default(autoincrement())
  reviewId    Int       @unique
  content     String    @db.VarChar(1000)
  createdById Int
  updatedById Int
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  review    Review @relation(fields: [reviewId], references: [id], onDelete: Restrict)
  createdBy User   @relation("ReviewReplyCreator", fields: [createdById], references: [id], onDelete: Restrict)
  updatedBy User   @relation("ReviewReplyUpdater", fields: [updatedById], references: [id], onDelete: Restrict)

  @@index([deletedAt, updatedAt])
  @@map("review_replies")
}
```

Các relation tương ứng được bổ sung vào `Review` và `User`. Role admin vẫn được kiểm tra ở router/service; database không suy luận quyền từ relation.

### 7.4. Không thêm catalog counter

Không thêm `reviewCount`, `ratingSum` hoặc `averageRating` vào `Product`. Review công khai trong bảng `reviews` là nguồn dữ liệu duy nhất. Quyết định này tránh drift khi review bị sửa, ẩn, xoá hoặc khôi phục.

## 8. Review image lifecycle

### 8.1. Thêm ảnh

1. Route chạy `authenticate` và xác minh review owner trước khi đọc/xử lý file.
2. Multer dùng `memoryStorage`, giới hạn số file và 3 MB cho mỗi file.
3. Pipeline kiểm tra magic bytes, decode thật bằng `sharp`, giới hạn input pixels, auto-rotate, bỏ metadata, resize trong khung tối đa `1600 × 1600` mà không upscale, rồi encode WebP.
4. Transaction khoá review row, kiểm tra review chưa xoá, đếm ảnh `PENDING/READY`, sinh object keys và tạo các row `PENDING`.
5. Service upload toàn bộ object.
6. Khi tất cả upload thành công, transaction chuyển các row sang `READY` và gán position.
7. Nếu một upload thất bại, các row của request chuyển sang `DELETING`; object đã upload được xoá best-effort. API trả lỗi storage ổn định.

Thao tác thêm nhiều ảnh là all-or-none ở mức hiển thị: không có ảnh nào của request xuất hiện trong DTO cho đến khi tất cả đều `READY`.

### 8.2. Sắp xếp

Client gửi toàn bộ image IDs `READY` chưa xoá của review theo thứ tự mong muốn. Backend từ chối danh sách thiếu, thừa, duplicate hoặc chứa image của review khác. Position được ghi lại trong một transaction.

### 8.3. Xoá ảnh

Transaction xác minh owner và chuyển ảnh sang `DELETING`, đặt `deletedAt`, nên ảnh biến mất khỏi DTO ngay. Sau commit, service xoá object. Thành công đặt `storageDeletedAt`; thất bại được log và reconciliation retry.

### 8.4. Tác động của review lifecycle

| Thao tác review | Images | Helpful | Official reply |
| --- | --- | --- | --- |
| Admin ẩn | Giữ nguyên, không public | Giữ nguyên, không public | Giữ nguyên, không public |
| Admin khôi phục | Public trở lại | Count trở lại | Public trở lại |
| Khách sửa | Giữ nguyên, cho phép quản lý | Giữ nguyên | Giữ nguyên |
| Khách xoá | Chuyển `DELETING` | Xoá votes | Soft-delete reply |
| Khách viết lại | Bắt đầu không có ảnh cũ | Bắt đầu từ 0 | Không khôi phục reply cũ |

Review viết lại vẫn giữ quy tắc moderation Phase 1–3: review từng bị `HIDDEN` không tự chuyển thành `PUBLISHED`.

### 8.5. Reconciliation

Một command idempotent xử lý:

- `PENDING` quá hạn: xoá object nếu có, chuyển sang cleanup state;
- `DELETING` chưa có `storageDeletedAt`: retry `deleteObject`;
- `READY` nhưng object mất: log lỗi có review/image IDs để vận hành xử lý, không âm thầm làm sai dữ liệu.

Command hỗ trợ chạy thủ công và theo scheduler hiện có của môi trường deploy. Không cần message queue. Repeated runs phải an toàn vì delete object là idempotent.

## 9. REST API

### 9.1. Review images

```http
POST   /api/v1/reviews/:id/images
PATCH  /api/v1/reviews/:id/images/order
DELETE /api/v1/reviews/:id/images/:imageId
```

`POST` nhận `multipart/form-data`, field `images`, từ một đến số slot còn lại trong giới hạn ba ảnh. Thành công trả `201` với các owner image DTO đã `READY`.

Order body:

```json
{
  "imageIds": [21, 18, 24]
}
```

`PATCH` trả owner image DTO theo thứ tự mới. `DELETE` idempotent với owner và trả `204`; image không tồn tại hoặc không thuộc review của owner trả cùng `404 REVIEW_IMAGE_NOT_FOUND` để tránh dò ID.

### 9.2. Helpful votes

```http
GET    /api/v1/reviews/helpful?reviewIds=1,2,3
PUT    /api/v1/reviews/:id/helpful
DELETE /api/v1/reviews/:id/helpful
```

Tất cả yêu cầu đăng nhập.

- Batch GET nhận tối đa 50 unique positive IDs và trả danh sách IDs người hiện tại đã vote.
- `PUT` tạo membership nếu chưa có; gọi lại vẫn thành công.
- `DELETE` xoá membership nếu có; gọi lại vẫn thành công.
- Chỉ review công khai mới được vote.
- Tác giả không được vote review của chính mình.

Mutation response trả count mới để optimistic UI hội tụ về dữ liệu server.

### 9.3. Official reply

```http
PUT    /api/v1/admin/reviews/:id/reply
DELETE /api/v1/admin/reviews/:id/reply
```

Body:

```json
{
  "content": "LaptopShop cảm ơn bạn đã chia sẻ trải nghiệm."
}
```

Content được trim, dài 1–1000 ký tự và body strict. `PUT` tạo mới, cập nhật hoặc tái kích hoạt reply đã soft-delete; ghi đúng `createdById` và `updatedById`. `DELETE` soft-delete và idempotent. Review đã bị khách xoá trả `409 REVIEW_DELETED`. Admin được reply review `HIDDEN`, nhưng reply chỉ public khi review được khôi phục.

### 9.4. Catalog

```http
GET /api/v1/products?minRating=4&sort=rating_desc
GET /api/v1/products/facets?minRating=4
```

- `minRating` chỉ nhận `3` hoặc `4`.
- Bật filter loại product chưa có review.
- `rating_desc` sắp theo `averageRating DESC`, `totalReviews DESC`, `productId ASC`.
- Product chưa có review nằm cuối khi chỉ sort mà không filter.
- Không thêm `rating_asc`.

## 10. DTO

### 10.1. Review image DTO

```json
{
  "id": 21,
  "url": "https://storage.example/signed-url",
  "width": 1200,
  "height": 900,
  "position": 0
}
```

Public và owner DTO không trả `objectKey`, storage status, byte size hoặc original filename. Admin DTO có thể nhận byte size và storage status phục vụ chẩn đoán, nhưng không nhận credentials.

### 10.2. Public review DTO bổ sung

```json
{
  "images": [],
  "helpfulCount": 7,
  "officialReply": {
    "content": "LaptopShop cảm ơn bạn đã chia sẻ trải nghiệm.",
    "createdAt": "2026-10-21T10:00:00.000Z",
    "updatedAt": "2026-10-21T10:00:00.000Z"
  }
}
```

`officialReply = null` khi chưa có hoặc đã soft-delete. Storefront tự hiển thị nhãn cố định “Phản hồi từ LaptopShop”; DTO không có admin ID hoặc admin name.

Owner DTO có images để form edit quản lý. Admin detail có images, helpful count, reply content và audit admin tối thiểu.

### 10.3. Catalog product DTO

Public product list/detail DTO bổ sung:

```json
{
  "reviewSummary": {
    "averageRating": 4.6,
    "totalReviews": 25
  }
}
```

Product chưa có review trả `averageRating = null` và `totalReviews = 0`.

## 11. Catalog aggregate và truy vấn

Định nghĩa thống nhất:

```sql
WITH review_stats AS (
  SELECT
    productId,
    AVG(rating) AS averageRating,
    COUNT(*) AS totalReviews
  FROM reviews
  WHERE status = 'PUBLISHED' AND deletedAt IS NULL
  GROUP BY productId
)
```

- Trang catalog bình thường lấy product page rồi chạy một aggregate query cho toàn bộ product IDs của page, không query từng card.
- Khi có `minRating` hoặc `rating_desc`, catalog repository dùng CTE/join để filter, count, order và paginate ở database.
- Facet repository hiện có được mở rộng để base CTE join `review_stats`; `minRating` tham gia mọi facet count giống các filter khác.
- Product detail aggregate theo một product ID.
- Không cache hoặc lưu counter ở Phase 4. Chỉ xem xét materialized summary khi profiling production chứng minh aggregate trở thành bottleneck.

Index hiện có `(productId, status, deletedAt, createdAt)` hỗ trợ nhóm theo product và điều kiện visibility. Implementation plan phải kiểm tra `EXPLAIN` trên MySQL test data trước khi quyết định có cần index khác.

## 12. Storefront UX

### 12.1. Review form

- vùng chọn ảnh nằm sau nội dung, hiển thị `n/3`;
- preview trước upload;
- mỗi ảnh có nút xoá, “Sang trái” và “Sang phải” với touch target tối thiểu 44px;
- drag-and-drop chỉ là progressive enhancement;
- ảnh hiện có và ảnh mới xuất hiện trong cùng thứ tự dự kiến;
- review content được lưu trước, sau đó ảnh được upload;
- nếu upload lỗi, dialog chuyển sang edit state và thông báo rõ review đã lưu, ảnh chưa lưu, có nút retry;
- review `HIDDEN` giữ cảnh báo moderation hiện tại và vẫn cho owner quản lý ảnh.

### 12.2. Review card

- một ảnh dùng toàn chiều rộng; hai–ba ảnh dùng responsive grid;
- width/height từ DTO giữ chỗ để tránh layout shift;
- lazy loading và lightbox/dialog hỗ trợ keyboard;
- media component hỗ trợ signed URL và không cache URL lâu hơn TTL;
- helpful button có `aria-pressed`, count, optimistic update và rollback;
- khách chưa đăng nhập được chuyển tới login với safe `next` quay lại đúng `#reviews`;
- self-vote bị disable và có accessible explanation;
- official reply có visual hierarchy riêng, nhãn “Phản hồi từ LaptopShop” và timestamp.

### 12.3. Catalog

- `ProductCard` hiển thị `★ 4.6 (25)`;
- chưa có review hiển thị “Chưa có đánh giá”;
- filter có “Từ 4 sao” và “Từ 3 sao”;
- sort có “Đánh giá cao nhất”;
- URL search params tiếp tục là nguồn trạng thái cho share, refresh và back/forward;
- desktop filters và mobile sheet dùng cùng `FacetDefinition` và parsing logic.

## 13. Admin UX

- Admin review detail hiển thị gallery, helpful count và official reply.
- Admin tạo, sửa hoặc xoá reply tại detail page; không đặt editor trong list table.
- Review `HIDDEN` vẫn hiển thị ảnh cho admin qua authorized presenter.
- Review đã bị khách xoá chỉ cho đọc lịch sử còn lại và không cho reply mới.
- Mutation có loading state, field/API errors và invalidate đúng query keys.
- Admin không được sửa ảnh, helpful votes hoặc nội dung review thay khách.

## 14. Validation, authorization và error codes

### 14.1. Ảnh

- định dạng input: JPEG, PNG hoặc WebP;
- tối đa 3 MB mỗi file;
- tối đa ba ảnh `PENDING/READY` chưa xoá cho mỗi review;
- giới hạn pixel được đặt trong `sharp` để chống decompression bomb;
- output luôn WebP, tối đa `1600 × 1600`, không upscale;
- original filename, MIME và extension do client cung cấp không được tin cậy;
- object key dùng UUID và không chứa PII.

Các code ổn định:

```text
REVIEW_IMAGE_INVALID_FILE
REVIEW_IMAGE_TOO_LARGE
REVIEW_IMAGE_LIMIT_REACHED
REVIEW_IMAGE_NOT_FOUND
REVIEW_IMAGE_ORDER_INVALID
REVIEW_IMAGE_STORAGE_UNAVAILABLE
```

Storage unavailable trả `503`. Validation trả `400` hoặc `413`. Ownership mismatch dùng `404 REVIEW_IMAGE_NOT_FOUND`.

### 14.2. Helpful

```text
REVIEW_NOT_PUBLIC
REVIEW_HELPFUL_SELF_VOTE
```

Review không tồn tại, hidden hoặc deleted dùng cùng public-not-found behavior nếu việc phân biệt trạng thái gây lộ dữ liệu. Self-vote trả `409 REVIEW_HELPFUL_SELF_VOTE`.

### 14.3. Official reply

```text
REVIEW_DELETED
REVIEW_REPLY_NOT_FOUND
```

Admin routes nằm sau admin router hiện có với `authenticate` và `requireRole("ADMIN")`.

## 15. Bảo mật và vận hành

- Tất cả config đi qua `env.ts`; không đọc `process.env` ở storage hoặc review modules.
- Dùng `lib/logger.ts`; không log credentials, signed URL đầy đủ hoặc file buffer.
- Bucket private và credentials áp dụng least privilege trên đúng bucket/prefix.
- Upload route có limiter chặt hơn global limiter; helpful mutations có limiter riêng theo user/IP phù hợp.
- React render content/reply dưới dạng plain text; không dùng `dangerouslySetInnerHTML`.
- Public DTO không chứa user ID, username, order ID, object key hoặc admin identity.
- Image ID luôn được kiểm tra cùng review ID và owner; không tin quan hệ client gửi.
- Presigned read URL chỉ được tạo sau khi service đã áp dụng visibility/authorization.
- Sentry có thể nhận exception/latency metadata nhưng không nhận image buffer hoặc secret.

## 16. Testing

### 16.1. API unit và route tests

- multipart validation, magic bytes, size và pixel limits;
- image normalization loại EXIF và tạo đúng dimensions/MIME;
- storage adapter contract với fake implementation;
- owner, non-owner, deleted review và hidden review;
- giới hạn ba ảnh, concurrent upload reservation, reorder đầy đủ/thiếu/thừa/duplicate;
- upload partial failure không làm image xuất hiện;
- delete idempotent và cleanup retry;
- helpful PUT/DELETE idempotent, duplicate concurrency, self-vote và non-public review;
- reply create/update/reactivate/delete, deleted review và role protection;
- mapper không lộ storage/admin/private data;
- OpenAPI route/schema/error contracts.

### 16.2. API integration tests

Chạy với MySQL thật và MinIO test service:

- upload object, đọc bằng signed URL và xoá object;
- `PENDING → READY → DELETING` lifecycle;
- review hide/restore/delete/reactivate tác động đúng tới images/votes/reply;
- cleanup/reconciliation repeated run;
- `minRating`, `rating_desc`, tie-breaker và product chưa có review;
- facet counts với rating kết hợp các filter hiện có;
- aggregate bỏ review hidden/deleted;
- kiểm tra query plan/index trên dataset test phù hợp.

### 16.3. Frontend tests

- preview, remove, reorder và giới hạn ba ảnh;
- review saved nhưng upload lỗi, retry thành công;
- gallery/lightbox và keyboard/focus behavior;
- helpful optimistic update, rollback, anonymous redirect và self-vote disabled;
- official reply public và admin mutations;
- `ProductCard` rating/no-rating;
- parse/serialize URL cho `minRating` và `rating_desc`;
- desktop/mobile filter dùng cùng semantics.

### 16.4. Verification commands

API:

```bash
npm run lint
npm run typecheck
npm test
npm run test:int
```

Web:

```bash
npm run lint
npm run lint:css
npm run typecheck
npm test
npm run build
npm run e2e
```

Integration và E2E phải dùng MySQL + MinIO thật. Nếu runtime không khả dụng, báo `NOT VERIFIED`; unit/static checks không thay thế bằng chứng runtime.

## 17. Rollout và rollback

1. Provision private bucket, lifecycle/CORS và least-privilege credentials.
2. Deploy additive migration của sub-project tương ứng.
3. Deploy API/OpenAPI; khi `REVIEW_IMAGES_ENABLED=true`, cấu hình storage thiếu phải fail fast.
4. Regenerate và commit web API client.
5. Deploy web.
6. Smoke test upload/read/hide/delete/cleanup, helpful, reply và catalog rating.
7. Theo dõi storage error rate, processing latency, pending/deleting backlog và aggregate query latency.

Migrations chỉ thêm model/field/index nên rollback application có thể bỏ qua contract mới mà không phá Phase 1–3. Không xoá bảng hoặc object trong rollback khẩn cấp. Media cleanup chỉ chạy khi code tương thích đã ổn định.

## 18. Acceptance criteria

Phase 4 hoàn thành khi:

- khách có review hợp lệ thêm, xoá, reorder tối đa ba ảnh và ảnh được chuẩn hoá/lưu trong object storage;
- review hidden/deleted không cấp media URL mới và customer delete không khôi phục ảnh/votes/reply cũ khi viết lại;
- người đăng nhập vote/unvote idempotent, không tự vote và count công khai chính xác;
- admin quản lý một official reply với audit nội bộ, storefront không lộ admin identity;
- catalog card, filter 3+/4+ và `rating_desc` đúng với review công khai, pagination ổn định và không N+1;
- OpenAPI/generated types đồng bộ;
- các verification command bắt buộc pass hoặc phần runtime chưa chạy được được ghi rõ `NOT VERIFIED`;
- không có secret, raw Prisma row, PII, raw object key hoặc file metadata nhạy cảm bị trả công khai.
