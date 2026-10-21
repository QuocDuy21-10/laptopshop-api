# Thiết kế tính năng đánh giá sản phẩm từ khách mua thật

Ngày: 2026-10-21

Phạm vi: `laptopshop-api` và `laptopshop-web`

Trạng thái: Đã được duyệt

## 1. Mục tiêu

Xây dựng hệ thống Verified Purchase Reviews cho LaptopShop. Khách hàng chỉ được đánh giá sản phẩm khi hệ thống chứng minh họ đã mua sản phẩm trong một đơn hàng hoàn tất và thanh toán thành công.

MVP phải mang lại hai giá trị:

- tăng độ tin cậy cho storefront bằng rating, nội dung nhận xét và nhãn mua hàng đã xác thực;
- thể hiện đầy đủ nghiệp vụ e-commerce gồm authorization theo đơn hàng, chống duplicate, quyền riêng tư, soft delete, thống kê và admin moderation.

Backend là nguồn quyết định duy nhất về quyền đánh giá và trạng thái công khai. Frontend chỉ dùng eligibility để trình bày UX phù hợp.

## 2. Phạm vi MVP

### 2.1. Trong phạm vi

- rating từ 1 đến 5 sao;
- title không bắt buộc và nội dung nhận xét bắt buộc;
- chỉ khách có `OrderDetail` thuộc đơn `COMPLETED + PAYMENT_SUCCESS` được đánh giá;
- mỗi người chỉ có một review cho mỗi product;
- lựa chọn bắt buộc giữa đánh giá ẩn danh và công khai toàn bộ `fullName`;
- danh sách review công khai, lọc theo sao, sắp xếp và phân trang;
- điểm trung bình, tổng số review và phân bố rating;
- khách sửa và xóa mềm review của mình;
- khách được viết lại sau khi xóa mềm;
- Product Detail và Order Detail có luồng tạo/sửa/xóa review;
- admin xem danh sách, chi tiết, bằng chứng mua hàng, ẩn và khôi phục review;
- OpenAPI và generated client đồng bộ giữa API và web;
- unit, route, integration và frontend tests.

### 2.2. Ngoài phạm vi

- ảnh review;
- helpful vote;
- phản hồi chính thức của cửa hàng;
- nhắc đánh giá;
- rating trên `ProductCard` hoặc bộ lọc catalog theo rating;
- AI/profanity moderation;
- moderation history đầy đủ theo từng event;
- Redis cache, message queue hoặc microservice mới.

## 3. Nguyên tắc nghiệp vụ

### 3.1. Điều kiện đánh giá

Một request tạo hoặc viết lại review hợp lệ khi tất cả điều kiện sau đúng:

1. Người dùng đã đăng nhập.
2. Product tồn tại.
3. Có `OrderDetail` mang `productId` đó.
4. `OrderDetail.order.userId` bằng `req.auth.id`.
5. Order có `status = COMPLETED`.
6. Order có `paymentStatus = PAYMENT_SUCCESS`.
7. Người dùng chưa có review đang hoạt động cho product.
8. Nếu chọn công khai tên, tài khoản phải có `fullName` khác rỗng.

`OrderDetail` hợp lệ gần nhất được dùng làm bằng chứng. Client không được gửi `userId`, `orderDetailId`, trạng thái review hoặc bất kỳ trường moderation nào.

Payment và fulfillment là hai trạng thái độc lập. Hệ thống phải kiểm tra cả `COMPLETED` và `PAYMENT_SUCCESS`, kể cả khi transition hiện tại thường bảo đảm chúng đi cùng nhau.

### 3.2. Một review cho mỗi người và product

Ràng buộc unique `(userId, productId)` là nguồn bảo vệ cuối cùng trước duplicate và request đồng thời. Việc khách mua cùng product nhiều lần không tạo thêm quyền đăng nhiều review.

### 3.3. Quyền riêng tư của tác giả

Form bắt buộc người dùng chọn một trong hai phương án mỗi lần tạo review:

- `isAnonymous = true`: storefront luôn hiển thị `****`;
- `isAnonymous = false`: storefront hiển thị toàn bộ `fullName` hiện tại.

Không có giá trị mặc định cho `isAnonymous` ở request hoặc database. Khi sửa, form hiển thị lựa chọn đã lưu để người dùng nhìn thấy và có thể đổi.

Nếu `fullName` không tồn tại, lựa chọn công khai bị vô hiệu hóa ở frontend và backend trả `REVIEW_FULL_NAME_REQUIRED` nếu client vẫn gửi request không ẩn danh. Public API không bao giờ dùng `username` làm fallback. Với dữ liệu legacy bất thường có `isAnonymous = false` nhưng thiếu `fullName`, mapper dùng `Khách hàng LaptopShop` thay vì làm lộ username.

Admin được xem danh tính thật để thực hiện moderation. Quyền này không làm thay đổi cách public DTO hiển thị tác giả.

### 3.4. Trạng thái hiển thị, xóa và moderation

Ba khía cạnh được lưu độc lập:

- `status`: `PUBLISHED` hoặc `HIDDEN`;
- `deletedAt`: khách đã xóa mềm hay chưa;
- `isAnonymous`: cách hiển thị tác giả.

Review chỉ công khai khi:

```text
status = PUBLISHED AND deletedAt IS NULL
```

Quy tắc vòng đời:

| Hiện trạng | Thao tác | Kết quả |
| --- | --- | --- |
| Chưa có review | Tạo | Tạo `PUBLISHED`, `deletedAt = null` |
| `PUBLISHED`, hoạt động | Sửa | Vẫn `PUBLISHED` |
| `HIDDEN`, hoạt động | Sửa | Vẫn `HIDDEN` |
| Review hoạt động | Khách xóa | Đặt `deletedAt = now()` |
| Đã xóa, trạng thái cũ `PUBLISHED` | Khách viết lại | Tái kích hoạt thành `PUBLISHED` |
| Đã xóa, trạng thái cũ `HIDDEN` | Khách viết lại | Tái kích hoạt nhưng vẫn `HIDDEN` |
| `PUBLISHED`, hoạt động | Admin ẩn | Thành `HIDDEN`, bắt buộc lý do |
| `HIDDEN`, hoạt động | Admin khôi phục | Thành `PUBLISHED`, xóa lý do ẩn |
| Review đã xóa | Admin khôi phục | Từ chối với `REVIEW_DELETED` |

Khách được sửa hoặc xóa review bị ẩn. Sửa và viết lại không tự vượt moderation. Admin phải xem nội dung mới rồi chủ động khôi phục.

Admin không được sửa rating, title, content, `isAnonymous`, tác giả hoặc bằng chứng mua hàng.

## 4. Kiến trúc

Tính năng nằm trong modular monolith hiện có.

```text
laptopshop-api/src/modules/reviews/
├── reviews.routes.ts
├── reviews.controller.ts
├── reviews.service.ts
├── reviews.schema.ts
└── reviews.mapper.ts
```

- Routes khai báo public, customer và admin endpoints.
- Controller chỉ chuyển đổi HTTP input/output và lấy `req.auth.id`.
- Schema dùng Zod để parse path, query và body.
- Service giữ eligibility, ownership, lifecycle, moderation và Prisma queries.
- Mapper khai báo DTO tường minh; không spread Prisma row.

MVP không thêm repository layer vì các module hiện tại chủ yếu gọi Prisma trực tiếp trong service. Không thêm cache hoặc worker.

Quan hệ nghiệp vụ:

```text
User ── Order ── OrderDetail ── Product
  └──────────────── Review ────────┘
                       │
                       └── moderatedBy: User?
```

## 5. Mô hình dữ liệu

```prisma
enum ReviewStatus {
  PUBLISHED
  HIDDEN
}

model Review {
  id            Int          @id @default(autoincrement())
  userId        Int
  productId     Int
  orderDetailId Int          @unique

  rating        Int          @db.UnsignedTinyInt
  title         String?      @db.VarChar(150)
  content       String       @db.VarChar(1500)
  isAnonymous   Boolean
  status        ReviewStatus @default(PUBLISHED)

  deletedAt     DateTime?
  createdAt     DateTime     @default(now())
  contentUpdatedAt DateTime  @default(now())
  updatedAt     DateTime     @updatedAt

  hiddenReason  String?      @db.VarChar(500)
  moderatedAt   DateTime?
  moderatedById Int?

  user        User        @relation("ReviewAuthor", fields: [userId], references: [id], onDelete: Restrict)
  product     Product     @relation(fields: [productId], references: [id], onDelete: Restrict)
  orderDetail OrderDetail @relation(fields: [orderDetailId], references: [id], onDelete: Restrict)
  moderatedBy User?       @relation("ReviewModerator", fields: [moderatedById], references: [id], onDelete: SetNull)

  @@unique([userId, productId])
  @@index([productId, status, deletedAt, createdAt])
  @@index([status, deletedAt, createdAt])
  @@map("reviews")
}
```

Các relation bổ sung:

```prisma
model User {
  reviews          Review[] @relation("ReviewAuthor")
  moderatedReviews Review[] @relation("ReviewModerator")
}

model Product {
  reviews Review[]
}

model OrderDetail {
  review Review?
}
```

Migration SQL bổ sung `CHECK (rating BETWEEN 1 AND 5)` để database bảo vệ invariant bên cạnh Zod. Migration phải được tạo trên `mysql-test`; production chỉ chạy `prisma migrate deploy`.

`orderDetailId @unique` bảo đảm một dòng hàng không làm bằng chứng cho nhiều review. Khi viết lại, service cập nhật sang `OrderDetail` hợp lệ gần nhất nếu cần.

`contentUpdatedAt` chỉ thay đổi khi khách tạo, sửa hoặc viết lại nội dung. `updatedAt` là timestamp kỹ thuật cho mọi thay đổi, bao gồm moderation và soft delete. Việc tách hai trường giúp admin xác định chính xác khách có sửa nội dung sau lần moderation hay không.

## 6. REST API

### 6.1. Public endpoints

```http
GET /api/v1/products/:id/reviews
GET /api/v1/products/:id/reviews/summary
```

List query:

```text
page: số nguyên dương, mặc định 1
pageSize: 1..50, mặc định 10
rating: 1..5, không bắt buộc
sort: newest | highest | lowest, mặc định newest
```

Thứ tự luôn có tie-breaker để phân trang ổn định:

- `newest`: `createdAt DESC, id DESC`;
- `highest`: `rating DESC, createdAt DESC, id DESC`;
- `lowest`: `rating ASC, createdAt DESC, id DESC`.

Public list chỉ trả review `PUBLISHED` và chưa xóa. Public read yêu cầu product đang `isActive = true`; product không tồn tại hoặc không public trả `404` giống catalog.

Public DTO:

```json
{
  "id": 18,
  "productId": 12,
  "rating": 5,
  "title": "Laptop chạy rất tốt",
  "content": "Máy hoạt động ổn định và phù hợp với công việc.",
  "author": {
    "name": "****",
    "anonymous": true
  },
  "verifiedPurchase": true,
  "createdAt": "2026-10-21T03:00:00.000Z",
  "updatedAt": "2026-10-21T03:00:00.000Z"
}
```

Public mapper ánh xạ `contentUpdatedAt` thành `updatedAt`; thay đổi moderation không làm storefront hiểu nhầm rằng khách vừa sửa nội dung. Public DTO không có `status`, `userId`, `username`, `orderDetailId`, order, địa chỉ, số điện thoại hoặc dữ liệu thanh toán.

Summary DTO:

```json
{
  "data": {
    "productId": 12,
    "averageRating": 4.6,
    "totalReviews": 25,
    "distribution": {
      "1": 0,
      "2": 0,
      "3": 2,
      "4": 6,
      "5": 17
    }
  }
}
```

Khi chưa có review, `averageRating = null`, `totalReviews = 0` và năm bucket đều bằng 0.

### 6.2. Customer endpoints

```http
GET    /api/v1/products/:id/reviews/eligibility
POST   /api/v1/products/:id/reviews
PATCH  /api/v1/reviews/:id
DELETE /api/v1/reviews/:id
```

Tất cả yêu cầu `authenticate`.

Eligibility trả một trong các reason:

```text
NOT_PURCHASED
ORDER_NOT_COMPLETED
PAYMENT_NOT_CONFIRMED
ALREADY_REVIEWED
```

Service áp dụng precedence: review hoạt động dẫn đến `ALREADY_REVIEWED`; nếu không có review hoạt động, bất kỳ purchase hợp lệ nào cũng dẫn đến eligible; không có `OrderDetail` dẫn đến `NOT_PURCHASED`; có order hoàn tất nhưng chưa thanh toán dẫn đến `PAYMENT_NOT_CONFIRMED`; các purchase còn lại dẫn đến `ORDER_NOT_COMPLETED`. Create vẫn tự kiểm tra lại điều kiện mua hàng thay vì tin kết quả eligibility trước đó.

Nếu đã có review hoạt động, response có `existingReview` để mở form sửa mà không cần endpoint riêng. Nếu review cũ đã xóa và có thể viết lại, response trả `eligible = true`; `willRequireModeration = true` khi trạng thái cũ là `HIDDEN`.

Create body:

```json
{
  "rating": 5,
  "title": "Laptop chạy rất tốt",
  "content": "Máy hoạt động ổn định và phù hợp với công việc.",
  "isAnonymous": true
}
```

Validation:

- `rating`: integer 1..5;
- `title`: trim, tối đa 150, chuỗi rỗng được chuẩn hóa thành `null`;
- `content`: trim, 10..1500;
- `isAnonymous`: boolean bắt buộc;
- body strict, từ chối field thừa.

Create mới và tái kích hoạt đều trả `201`. Nếu có review hoạt động, trả `409 REVIEW_ALREADY_EXISTS`.

PATCH chỉ nhận `rating`, `title`, `content`, `isAnonymous`. Không field nào ngoài danh sách được phép. Review `HIDDEN` vẫn giữ `HIDDEN`. Review đã xóa trả `409 REVIEW_DELETED` để client chuyển sang luồng viết lại.

DELETE đặt `deletedAt = now()` và trả `204`. Gọi lại DELETE với cùng owner trên review đã xóa vẫn trả `204`. Review không tồn tại hoặc thuộc người khác đều trả `404 REVIEW_NOT_FOUND` để tránh dò ID.

### 6.3. Admin endpoints

```http
GET   /api/v1/admin/reviews
GET   /api/v1/admin/reviews/summary
GET   /api/v1/admin/reviews/:id
PATCH /api/v1/admin/reviews/:id/moderation
```

Các route được mount trong admin router hiện có sau `authenticate` và `requireRole("ADMIN")`.

Admin list hỗ trợ:

- `page`, `pageSize`;
- tìm theo product hoặc khách hàng;
- `productId`;
- `rating`;
- `status`;
- trạng thái deleted;
- `from`, `to`.

Admin detail trả nội dung, tác giả thật, product và bằng chứng mua hàng tối thiểu gồm `orderId`, `orderDetailId`, order status, payment status và `completedAt`. Không trả receiver address, receiver phone, payment payload hoặc dữ liệu không phục vụ moderation.

Moderation body:

```json
{
  "status": "HIDDEN",
  "reason": "Nội dung chứa thông tin không phù hợp"
}
```

- Chuyển sang `HIDDEN` bắt buộc reason 1..500.
- Chuyển sang `PUBLISHED` không nhận reason và đặt `hiddenReason = null`.
- Cả hai thao tác cập nhật `moderatedById` và `moderatedAt`.
- Review đã xóa trả `409 REVIEW_DELETED`.
- Request `HIDDEN` trên review đã ẩn cập nhật reason và moderation metadata.
- Request `PUBLISHED` trên review đã public trả bản ghi hiện tại mà không thay đổi moderation metadata.

### 6.4. Mã lỗi ổn định

```text
REVIEW_NOT_ELIGIBLE
REVIEW_ALREADY_EXISTS
REVIEW_FULL_NAME_REQUIRED
REVIEW_DELETED
REVIEW_INVALID_MODERATION
REVIEW_NOT_FOUND
```

`REVIEW_NOT_ELIGIBLE` có `details.reason` tương ứng eligibility. Các lỗi expected dùng `AppError`; không dùng `console` và không log PII.

## 7. Thuật toán service và concurrency

### 7.1. Tạo review mới

1. Xác nhận product tồn tại; API ghi chấp nhận cả product inactive để khách mua trước đó vẫn đánh giá từ Order Detail.
2. Tìm bằng chứng mua hợp lệ gần nhất theo `OrderDetail.id DESC` hoặc order completion mới nhất có tie-breaker xác định.
3. Kiểm tra `fullName` nếu `isAnonymous = false`.
4. Kiểm tra review hiện tại theo `(userId, productId)`.
5. Nếu chưa có, gọi `review.create`.
6. Ánh xạ Prisma `P2002` thành `REVIEW_ALREADY_EXISTS`.

### 7.2. Tái kích hoạt review đã xóa

Hai request đồng thời có thể cùng đọc thấy `deletedAt != null`. Vì vậy service không dùng `update` không điều kiện. Nó dùng conditional `updateMany` với:

```text
id = existing.id AND userId = req.auth.id AND deletedAt IS NOT NULL
```

Chỉ request có `count = 1` thành công. Request còn lại nhận `REVIEW_ALREADY_EXISTS`. Update đặt nội dung mới, lựa chọn danh tính, `orderDetailId` mới, `contentUpdatedAt = now()` và `deletedAt = null`; trạng thái `HIDDEN` được giữ nguyên.

### 7.3. Sửa và xóa

Ownership luôn nằm trong Prisma `where`, không tải record rồi chỉ so sánh ở controller. PATCH không thay đổi moderation fields. DELETE không xóa vật lý.

### 7.4. Summary

Summary dùng một Prisma `groupBy` theo rating với điều kiện public. Distribution, total và weighted average được tính từ cùng kết quả. Chưa denormalize vào Product và chưa dùng Redis.

## 8. OpenAPI

Mọi endpoint, path/query/body schema, response DTO, error response và security requirement phải được thêm vào `src/docs/openapi.ts`.

`tests/docs/openapi.test.ts` phải kiểm tra đầy đủ route mới. Sau khi API chạy với docs enabled, web chạy:

```bash
npm run gen:api
```

`src/lib/api/schema.d.ts` được commit và không sửa tay. Frontend chỉ lấy API types từ generated schema và các export trong `src/lib/api/types.ts`.

## 9. Storefront

### 9.1. Cấu trúc

```text
laptopshop-web/src/features/reviews/
├── ReviewSection/
├── ReviewSummary/
├── ReviewList/
├── ReviewCard/
├── ReviewDialog/
├── ReviewForm/
├── ReviewAction/
├── hooks.ts
├── schema.ts
└── server.ts
```

Các component dùng SCSS Modules, tokens trong LaptopShop Evergreen, component UI hiện có và Vietnamese copy. Không dùng Tailwind, CSS-in-JS hoặc inline color.

### 9.2. Product Detail

Product page tiếp tục là Server Component. `server.ts` tải summary và trang review đầu tiên bằng `freshServerApi`, rồi truyền làm initial data cho `ReviewSection` client island. Session và eligibility chỉ được tải ở client.

`ReviewSection` nằm sau thông số và mô tả, có `id="reviews"`, gồm:

- điểm trung bình, tổng lượt và distribution;
- filter rating;
- sort;
- danh sách và pagination;
- hành động theo session và eligibility.

Các trạng thái UX:

- chưa đăng nhập: liên kết login giữ `next=/products/:id#reviews`;
- chưa mua;
- đơn chưa hoàn tất;
- thanh toán chưa xác nhận;
- đủ điều kiện;
- đã đánh giá;
- review đang ẩn;
- review đã xóa và có thể viết lại.

### 9.3. ReviewForm

Form dùng React Hook Form, Zod và `zodResolver`.

- Năm sao là radio input thật, dùng được bằng bàn phím và screen reader.
- Anonymous/public là fieldset radio bắt buộc; create không có default.
- Public option bị disable khi thiếu `fullName`, kèm liên kết cập nhật hồ sơ.
- Dialog trap focus, hỗ trợ Escape và trả focus về trigger.
- Khi mutation đang chạy, submit bị khóa để tránh duplicate.
- Field errors đi qua `applyFieldErrors`; lỗi tổng đi qua `errorMessage`.
- Delete có dialog xác nhận riêng.

### 9.4. Order Detail

Mỗi item của order `COMPLETED + PAYMENT_SUCCESS` có `ReviewAction`. Component chỉ tải eligibility khi người dùng bấm, tránh N requests khi mở order nhiều sản phẩm.

`ReviewAction` mở cùng `ReviewDialog` thay vì chỉ liên kết tới Product Detail. Vì vậy khách vẫn đánh giá được product inactive còn tồn tại trong lịch sử đơn hàng.

### 9.5. Query keys và cache invalidation

```ts
reviews: (productId: number) => ["reviews", productId] as const
reviewSummary: (productId: number) => ["reviews", productId, "summary"] as const
productReviews: (productId: number, query: object) => ["reviews", productId, "list", query] as const
reviewEligibility: (productId: number, userId: number) => ["reviews", productId, "eligibility", userId] as const
```

Eligibility key luôn có `userId`. Create/update/delete invalidate summary, list và eligibility của product. Public server snapshot chỉ là initial data; client refetch sau mutation là nguồn trạng thái mới cho phiên hiện tại.

## 10. Admin moderation UI

### 10.1. Routes và cấu trúc

```text
src/features/admin/reviews/
├── ReviewList.tsx
├── ReviewsTable.tsx
├── ReviewDetail.tsx
├── ReviewModerationActions.tsx
├── ReviewStatusTag.tsx
└── hooks.ts

src/app/(admin)/admin/reviews/
├── page.tsx
└── [id]/page.tsx
```

`AdminShell` thêm menu “Đánh giá”. UI dùng Ant Design và pattern hiện tại của Order list/detail.

### 10.2. Danh sách

Trang danh sách hiển thị số liệu thực:

- tổng review hoạt động;
- rating trung bình public;
- số review bị ẩn;
- số review khách đã xóa.

Filter được đồng bộ query string qua `useListParams`. Bảng ưu tiên product, rating, trạng thái và action, đồng thời hỗ trợ horizontal scroll trên màn hình nhỏ. Mặc định chỉ tải review chưa xóa; deleted chỉ xuất hiện khi chọn filter.

Admin thấy tác giả thật và nhãn “Đánh giá ẩn danh” khi phù hợp.

### 10.3. Chi tiết

Trang chi tiết có các Card:

1. Nội dung review và trạng thái.
2. Tác giả.
3. Bằng chứng mua hàng và liên kết tới admin order detail.
4. Moderation gần nhất.

Nếu review đang `HIDDEN` và `contentUpdatedAt > moderatedAt`, hiển thị cảnh báo khách đã sửa sau khi review bị ẩn.

### 10.4. Thao tác

- Hide mở Modal bắt buộc reason và dùng destructive styling.
- Restore dùng Popconfirm.
- Không optimistic update; chờ backend rồi invalidate `queryKeys.adminAll` và public review queries liên quan.
- Review deleted không có action khôi phục.
- Lỗi dùng `errorMessage`; 404 dùng Ant Design Result.

## 11. Accessibility và responsive

- Hỗ trợ viewport 320px, 200% zoom và nội dung tiếng Việt dài.
- Touch target chính tối thiểu 44x44px.
- Focus ring rõ ràng và không dùng hover làm tín hiệu duy nhất.
- Rating có accessible labels; distribution có text count bên cạnh biểu diễn trực quan.
- Filter có label, pagination dùng được bằng bàn phím.
- Loading skeleton giữ layout ổn định.
- Empty, error, hidden và deleted có nội dung riêng.
- Review content được render plain text; không dùng `dangerouslySetInnerHTML`.
- Màu sắc dùng semantic tokens và đạt WCAG AA.

## 12. Bảo mật và dữ liệu

- Không đọc `process.env` ngoài `src/config/env.ts`.
- Dùng `lib/logger.ts`, không dùng `console`.
- Expected errors dùng `AppError` với stable code.
- Customer queries scope bằng `req.auth.id`.
- Public mapper allow-list field và không spread Prisma row.
- Không log review content, full name hoặc order evidence ở mức log thông thường.
- Global rate limiter hiện tại áp dụng cho endpoints mới. MVP chưa thêm review-specific limiter.
- React render plain text để tránh stored XSS.
- Product public read và authenticated write có visibility policy riêng như mục 6 và 7.

## 13. Kiểm thử

### 13.1. Backend unit và route tests

Bao phủ:

- rating, độ dài, strict body và `isAnonymous` bắt buộc;
- anonymous/public mapper và không rò rỉ field;
- chưa đăng nhập, chưa mua, chưa hoàn tất, chưa thanh toán;
- tạo hợp lệ và product inactive qua customer write;
- duplicate;
- ownership khi sửa/xóa;
- soft delete và viết lại;
- hidden giữ nguyên sau edit/reactivation;
- hidden/deleted không nằm trong public list/summary;
- admin hide cần reason;
- admin không restore deleted;
- sort/pagination;
- OpenAPI paths, schemas và security.

### 13.2. Real-MySQL integration tests

Bao phủ:

- unique `(userId, productId)`;
- unique `orderDetailId`;
- database rating check;
- hai request tạo đồng thời;
- hai request tái kích hoạt đồng thời;
- summary sau create, update, hide, restore và delete.

Các tests này thuộc `npm run test:int` vì Prisma mock không chứng minh được database constraints và concurrency.

### 13.3. Frontend tests

Storefront:

- keyboard star selection;
- anonymous/public bắt buộc;
- public disabled khi thiếu full name;
- create/edit/delete và field error mapping;
- tất cả eligibility states;
- hidden không tự publish;
- lazy eligibility trong Order Detail;
- query invalidation;
- loading, empty, error, filter và pagination.

Admin:

- URL filter parsing;
- list và summary;
- hide reason bắt buộc;
- restore hợp lệ;
- deleted không có action;
- cảnh báo edited-after-moderation;
- 404 và mutation errors.

### 13.4. E2E

Với API và MySQL thật:

1. Khách có order hoàn tất tạo review.
2. Review xuất hiện công khai và summary thay đổi.
3. Admin ẩn review.
4. Review biến mất khỏi storefront và summary thay đổi.
5. Khách sửa nhưng review vẫn ẩn.
6. Admin khôi phục.
7. Khách đổi sang ẩn danh và storefront hiển thị `****`.
8. Khách xóa rồi viết lại.

Nếu không có runtime thật, báo `NOT VERIFIED`; không suy diễn E2E từ unit tests.

## 14. Verification bắt buộc

API:

```bash
npm run lint
npm run typecheck
npm test
npm run test:int
```

Web:

```bash
npm run gen:api
npm run lint
npm run lint:css
npm run typecheck
npm test
npm run build
```

`npm run gen:api` cần API đang chạy với `ENABLE_DOCS=true`. Frontend E2E cần API/MySQL runtime thật. Lỗi kết nối runtime phải được phân loại là môi trường chưa sẵn sàng, không tự kết luận là regression sản phẩm.

## 15. Thứ tự triển khai

1. Prisma schema, migration và database constraints.
2. Review schemas, mapper và service core.
3. Public/customer routes và tests.
4. Admin routes, moderation và tests.
5. OpenAPI tests và generated web client.
6. Storefront ReviewSection, ReviewForm và Order Detail action.
7. Admin list/detail/moderation UI.
8. Static checks, unit tests, integration tests, build và E2E.

## 16. Tiêu chí hoàn thành

MVP hoàn thành khi:

- database, API, OpenAPI và generated client đồng bộ;
- Verified Purchase được xác minh hoàn toàn ở backend;
- concurrency tests chứng minh không tạo duplicate;
- Product Detail và Order Detail hỗ trợ đầy đủ create/edit/delete;
- lựa chọn ẩn danh không làm rò rỉ danh tính ở public API hoặc UI;
- hidden/deleted review không xuất hiện hoặc ảnh hưởng rating public;
- admin có thể xem bằng chứng, ẩn và khôi phục đúng policy;
- checks bắt buộc của cả hai repository xanh;
- các đường chạy chưa có runtime thật được ghi rõ `NOT VERIFIED`;
- không triển khai các mục ngoài phạm vi MVP.
