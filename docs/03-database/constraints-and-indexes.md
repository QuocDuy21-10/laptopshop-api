# Ràng buộc và index

Tài liệu này trả lời: bảng nào có unique, khoá chính ghép, index nào, chúng bảo vệ bất biến nào, và ràng buộc nào chỉ tồn tại trong migration mà không có trong `schema.prisma`.

> Đối chiếu code: main @ 0f1eab2 (2026-11-04)

## Tổng quan

Schema có 47 ràng buộc unique hoặc khoá chính ghép (5 khoá chính ghép, 42 unique) và 67 index khai báo bằng `@@index`. Bảng dưới đây liệt kê tất cả, theo nhóm.

- **Khoá chính:** hầu hết bảng dùng `id` tự tăng. Ngoại lệ: `Payment`, `PaymentWebhookEvent`, `PaymentReviewCase`, `PaymentReviewAction`, `StockReceipt` dùng UUID (`CHAR(36)`); `CatalogPriceWindow` dùng `BIGINT`; `CouponPolicy`, `AutomaticPromotionPolicy`, `FlashSalePolicy` dùng chính `promotionId` làm khoá chính (quan hệ một-một với `Promotion`); `WorkerCheckpoint` dùng `workerName`. Khoá chính ghép được liệt kê trong bảng.
- **Index của khoá ngoại:** MySQL (InnoDB) tự tạo index cho cột khoá ngoại khi chưa có index nào dùng cột đó đứng đầu, nên không phải khoá ngoại nào cũng xuất hiện trong danh sách `@@index` dưới đây.
- **Cột "Phục vụ" của index là suy luận** từ tên cột và cách module dùng dữ liệu; chưa đo bằng `EXPLAIN`. Cột "Bảo vệ" của unique là bất biến đã ghi ở mục **Bất biến** của model tương ứng.
- **`Product` không có index phụ nào trong schema.** Truy vấn catalog dựa vào khoá chính, vào `CatalogPriceWindow` (giá hiệu lực) và vào index của các bảng liên quan. Các script `products:audit-facets` và `products:audit-rating` (xem [background-jobs.md](../02-architecture/background-jobs.md)) dùng để kiểm tra các truy vấn đó.

## Theo nhóm

### Identity & Accounts

Xem dictionary ở [contexts/identity-accounts.md](contexts/identity-accounts.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `User` | Unique | `username` | Mỗi email chỉ có một tài khoản. |
| `Role` | Unique | `name` | Tên vai trò không trùng. |
| `RefreshToken` | Unique | `tokenHash` | Tra cứu token theo hash; hash không trùng. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `EmailVerificationChallenge` | `userId,consumedAt,invalidatedAt,expiresAt` | Tìm mã còn hiệu lực của một người dùng (chưa dùng, chưa vô hiệu, chưa hết hạn). |
| `RefreshToken` | `familyId` | Thu hồi cả họ token. |

### Catalog & Reviews

Xem dictionary ở [contexts/catalog-reviews.md](contexts/catalog-reviews.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `Review` | Unique | `orderDetailId` | Mỗi dòng đơn chỉ gắn một đánh giá. |
| `Review` | Unique | `userId, productId` | Mỗi người dùng một đánh giá cho mỗi sản phẩm. |
| `ReviewImage` | Unique | `objectKey` | Mỗi file storage chỉ có một dòng. |
| `ReviewImage` | Unique | `syncOperationId, syncClientId` | Mỗi ảnh client gửi trong một lần đồng bộ chỉ tạo một dòng. |
| `ReviewImageSyncOperation` | Unique | `userId, reviewId, idempotencyKey` | Đồng bộ ảnh idempotent. |
| `ReviewHelpful` | Khoá chính ghép | `reviewId, userId` | Mỗi người dùng một lượt bình chọn cho mỗi đánh giá. |
| `ReviewReply` | Unique | `reviewId` | Mỗi đánh giá một phản hồi. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `Review` | `productId,status,deletedAt,createdAt` | Danh sách đánh giá công khai của một sản phẩm. |
| `Review` | `status,deletedAt,createdAt` | Danh sách đánh giá cho admin kiểm duyệt. |
| `ReviewImage` | `reviewId,status,position` | Ảnh của một đánh giá theo thứ tự. |
| `ReviewImage` | `status,updatedAt` | Quét ảnh quá hạn để dọn. |
| `ReviewImageSyncOperation` | `status,leaseExpiresAt` | Tìm lần đồng bộ cần tiếp quản khi lease hết hạn. |
| `ReviewImageSyncOperation` | `expiresAt` | Dọn kết quả idempotent hết hạn. |
| `ReviewHelpful` | `userId,createdAt` | Các bình chọn của một người dùng. |
| `ReviewReply` | `deletedAt,updatedAt` | Lọc phản hồi còn hiệu lực. |
| `HomeBanner` | `placement,isActive,position` | Banner công khai theo vị trí và thứ tự. |

### Shopping & Orders

Xem dictionary ở [contexts/shopping-orders.md](contexts/shopping-orders.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `Cart` | Unique | `userId` | Mỗi người dùng một giỏ hàng. |
| `CartDetail` | Unique | `cartId, productId` | Mỗi sản phẩm một dòng trong giỏ. |
| `Order` | Unique | `userId, idempotencyKey` | Gửi lại cùng `Idempotency-Key` không tạo đơn thứ hai. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `Order` | `status,createdAt` | Lọc đơn theo trạng thái và sắp theo thời gian (danh sách admin). |
| `Order` | `createdAt` | Lọc và sắp đơn theo thời gian. |
| `OrderStatusHistory` | `orderId,createdAt` | Lịch sử trạng thái của một đơn. |

### Payments

Xem dictionary ở [contexts/payments.md](contexts/payments.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `Payment` | Unique | `orderId` | Mỗi đơn một thanh toán. |
| `Payment` | Unique | `transferCode` | Mã chuyển khoản không trùng, để khớp giao dịch với đơn. |
| `PaymentWebhookEvent` | Unique | `provider, providerMode, providerEventId` | Mỗi sự kiện của nhà cung cấp chỉ ghi một lần. |
| `PaymentWebhookEvent` | Unique | `provider, providerMode, providerTransactionKey` | Mỗi giao dịch của nhà cung cấp chỉ ghi một lần, dù đến bằng webhook hay đối soát. |
| `PaymentProviderCheckpoint` | Unique | `provider, mode` | Mỗi nhà cung cấp và chế độ một checkpoint. |
| `PaymentReviewCase` | Unique | `paymentId` | Mỗi thanh toán tối đa một ca xem xét. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `Payment` | `status,cancelAfter` | Tiến trình bảo trì quét thanh toán đến mốc huỷ. |
| `Payment` | `status,reviewAfter` | Tiến trình bảo trì quét thanh toán đến mốc xem xét. |
| `PaymentWebhookEvent` | `status,receivedAt` | Danh sách giao dịch cần xem xét cho admin. |
| `PaymentWebhookEvent` | `paymentId` | Giao dịch của một thanh toán. |
| `PaymentReviewCase` | `status,openedAt` | Danh sách ca đang mở. |
| `PaymentReviewAction` | `reviewCaseId,createdAt` | Thao tác của một ca theo thời gian. |

### Inventory

Xem dictionary ở [contexts/inventory.md](contexts/inventory.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `StockMovement` | Unique | `actorId, idempotencyKey` | Điều chỉnh tồn kho của admin idempotent. |
| `StockReceipt` | Unique | `code` | Mã phiếu nhập không trùng. |
| `StockReceiptItem` | Unique | `receiptId, productId` | Mỗi sản phẩm một dòng trong phiếu nhập. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `StockMovement` | `productId,createdAt` | Sổ kho của một sản phẩm theo thời gian. |
| `StockMovement` | `createdAt` | Lọc sổ kho theo khoảng ngày. |
| `StockMovement` | `receiptId` | Biến động sinh từ một phiếu nhập. |
| `StockReceipt` | `status,createdAt` | Danh sách phiếu theo trạng thái. |
| `StockReceipt` | `createdById,createdAt` | Phiếu của một admin. |
| `StockReceiptItem` | `productId` | Tìm phiếu nhập chứa một sản phẩm (chặn xoá sản phẩm). |

### Promotions & Pricing

Xem dictionary ở [contexts/promotions-pricing.md](contexts/promotions-pricing.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `CatalogPriceWindow` | Unique | `productId, validFrom` | Một sản phẩm chỉ có một cửa sổ giá cho mỗi mốc bắt đầu. |
| `CouponPolicy` | Unique | `code` | Mã giảm giá không trùng. |
| `PromotionProduct` | Khoá chính ghép | `promotionId, productId` | Mỗi sản phẩm một lần trong khuyến mãi. |
| `PromotionUserUsage` | Khoá chính ghép | `promotionId, userId` | Một dòng đếm cho mỗi (khuyến mãi, người dùng). |
| `PromotionRedemption` | Unique | `orderId` | Mỗi đơn dùng tối đa một mã giảm giá. |
| `FlashSaleProductQuota` | Khoá chính ghép | `promotionId, productId` | Một hạn mức cho mỗi (flash sale, sản phẩm). |
| `FlashSaleUserUsage` | Khoá chính ghép | `promotionId, productId, userId` | Một dòng đếm cho mỗi (flash sale, sản phẩm, người dùng). |
| `FlashSaleAllocation` | Unique | `orderDetailId` | Mỗi dòng đơn giữ suất tối đa một lần. |
| `FlashSaleAllocation` | Unique | `promotionId, productId, orderId` | Mỗi (flash sale, sản phẩm, đơn) một lần giữ suất. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `Promotion` | `kind,state,startsAt,endsAt` | Tìm khuyến mãi đang hiệu lực theo loại. |
| `CatalogPriceWindow` | `productId,validFrom,validUntil` | Tìm cửa sổ giá hiệu lực của một sản phẩm tại một thời điểm. |
| `CatalogPriceWindow` | `automaticPromotionId` | Tìm cửa sổ giá sinh từ một khuyến mãi (khi dựng lại). |
| `CouponPolicy` | `isPublic` | Liệt kê mã công khai. |
| `AutomaticPromotionPolicy` | `priority` | Chọn khuyến mãi tự động theo mức ưu tiên. |
| `PromotionProduct` | `productId,promotionId` | Tìm khuyến mãi áp dụng cho một sản phẩm. |
| `PromotionRedemption` | `promotionId,status,createdAt` | Thống kê lượt dùng của một khuyến mãi. |
| `PromotionRedemption` | `userId,promotionId,status` | Lượt dùng của một người dùng cho một khuyến mãi. |
| `FlashSaleProductQuota` | `productId,promotionId` | Tìm flash sale của một sản phẩm. |
| `FlashSaleUserUsage` | `userId,promotionId` | Lượt giữ suất của một người dùng. |
| `FlashSaleAllocation` | `promotionId,productId,status` | Tổng suất đang giữ của một hạn mức (kiểm tra bởi `verify-flash-sale`). |
| `FlashSaleAllocation` | `userId,promotionId,status` | Suất đang giữ của một người dùng. |
| `FlashSaleAllocation` | `createdAt` | Lọc theo thời gian. |

### After-sales

Xem dictionary ở [contexts/after-sales.md](contexts/after-sales.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `ServiceRequest` | Unique | `code` | Mã yêu cầu bảo hành không trùng. |
| `ServiceRequest` | Unique | `userId, idempotencyKey` | Gửi lại cùng khoá không tạo yêu cầu thứ hai. |
| `ServiceRequestItem` | Unique | `serviceRequestId, position` | Mỗi thiết bị một vị trí riêng trong yêu cầu. |
| `ServiceRequestAttachment` | Unique | `objectKey` | Mỗi file storage chỉ có một dòng. |
| `ServiceRequestAttachment` | Unique | `serviceRequestItemId, uploadKey, uploadPosition` | Tải lên idempotent theo `Upload-Key`. |
| `ServiceQuote` | Unique | `serviceRequestItemId, version` | Số thứ tự báo giá của thiết bị không trùng. |
| `ServiceQuoteLine` | Unique | `quoteId, position` | Mỗi dòng báo giá một vị trí riêng. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `ServiceRequest` | `userId,createdAt` | Danh sách yêu cầu của một khách. |
| `ServiceRequest` | `status,createdAt` | Danh sách yêu cầu theo trạng thái cho nhân viên. |
| `ServiceRequest` | `assignedToId,status` | Yêu cầu được giao cho một nhân viên theo trạng thái. |
| `ServiceRequest` | `previousRequestId` | Tìm các yêu cầu tiếp nối của một yêu cầu. |
| `ServiceRequestItem` | `orderDetailId,status` | Kiểm tra dòng đơn đã có thiết bị đang xử lý hay chưa. |
| `ServiceRequestItem` | `serviceRequestId,status` | Trạng thái các thiết bị của một yêu cầu (tính trạng thái tổng hợp). |
| `ServiceRequestItem` | `confirmationDueAt,status` | Quét thiết bị quá hạn xác nhận để tự đóng. |
| `WarrantyVerification` | `orderDetailId,createdAt,id` | Lấy kết luận bảo hành mới nhất của một dòng đơn. |
| `WarrantyVerification` | `serviceRequestItemId,createdAt,id` | Lấy kết luận bảo hành mới nhất của một thiết bị. |
| `ServiceRequestEvent` | `serviceRequestId,createdAt,id` | Dòng thời gian của một yêu cầu. |
| `ServiceRequestEvent` | `serviceRequestItemId,createdAt,id` | Dòng thời gian của một thiết bị. |
| `ServiceRequestAttachment` | `serviceRequestId,createdAt` | Ảnh của một yêu cầu. |
| `ServiceRequestAttachment` | `serviceRequestItemId,status,createdAt` | Ảnh còn hoạt động của một thiết bị (đếm giới hạn 15 ảnh). |
| `ServiceRequestAttachment` | `status,updatedAt` | Quét ảnh `PENDING`/`DELETING` quá hạn để dọn. |
| `ServiceQuote` | `serviceRequestItemId,status` | Tìm báo giá đang chờ của một thiết bị. |
| `ServiceQuote` | `validUntil,status` | Quét báo giá quá hạn. |

### Messaging & Ops

Xem dictionary ở [contexts/messaging-ops.md](contexts/messaging-ops.md).

| Bảng | Loại | Cột | Bảo vệ |
| --- | --- | --- | --- |
| `WishlistItem` | Unique | `userId, productId` | Một sản phẩm chỉ yêu thích một lần mỗi người dùng. |
| `Notification` | Unique | `dedupeKey` | Cùng một sự kiện không tạo hai thông báo. |
| `NotificationPreference` | Unique | `userId` | Mỗi người dùng một dòng lựa chọn. |
| `PushSubscription` | Unique | `endpointHash` | Một trình duyệt chỉ có một đăng ký push. |
| `NotificationDelivery` | Unique | `dedupeKey` | Cùng thông báo và đích không tạo hai lần gửi. |
| `OutboxEvent` | Unique | `dedupeKey` | Một sự kiện không được phát hai lần. |
| `WorkerHeartbeat` | Unique | `workerName, instanceId` | Mỗi tiến trình worker một dòng heartbeat (ghi bằng `upsert`). |
| `NewsletterSubscriber` | Unique | `email` | Mỗi email một đăng ký. |
| `NewsletterSubscriber` | Unique | `confirmTokenHash` | Tra cứu đăng ký theo token xác nhận. |

| Bảng | Cột (theo thứ tự) | Phục vụ |
| --- | --- | --- |
| `WishlistItem` | `productId,alertMode` | Tìm các wishlist đang bật cảnh báo theo sản phẩm khi đánh giá giá. |
| `WishlistItem` | `userId,createdAt` | Liệt kê wishlist của một người dùng theo thời gian. |
| `Notification` | `userId,readAt,createdAt` | Liệt kê thông báo và đếm chưa đọc của một người dùng. |
| `Notification` | `serviceRequestId,createdAt` | Liệt kê thông báo của một yêu cầu bảo hành. |
| `PushSubscription` | `userId,disabledAt` | Lấy các đăng ký push còn hoạt động của một người dùng. |
| `NotificationDelivery` | `status,nextAttemptAt` | Tìm lần gửi đến hạn thử lại. |
| `NotificationDelivery` | `notificationId,channel` | Lấy các lần gửi của một thông báo theo kênh. |
| `NotificationDelivery` | `emailVerificationChallengeId,channel` | Lấy các lần gửi của một mã OTP theo kênh. |
| `NotificationDeliveryAudit` | `deliveryId,createdAt` | Lịch sử thao tác của một lần gửi. |
| `OutboxEvent` | `publishedAt,availableAt,leaseExpiresAt` | Dispatcher chọn sự kiện chưa phát, đã đến hạn và chưa bị thuê (`claimOutboxBatch`). |
| `WorkerHeartbeat` | `workerName,lastSeenAt` | Tìm heartbeat mới nhất của một worker. |
| `NewsletterSubscriber` | `status,createdAt` | Danh sách đăng ký theo trạng thái cho admin. |

## Ràng buộc chỉ có trong migration

`schema.prisma` không thể khai báo ràng buộc `CHECK`, nên các ràng buộc này chỉ tồn tại trong SQL của migration. Đã quét toàn bộ `prisma/migrations/` tìm `CHECK`, `FULLTEXT`, cột `GENERATED`, trigger và view; chỉ có một kết quả:

| Bảng | Tên ràng buộc | Điều kiện | Migration |
| --- | --- | --- | --- |
| `reviews` | `reviews_rating_check` | `rating BETWEEN 1 AND 5` | `20261021040546_add_product_reviews` |

Hệ quả: dữ liệu `Review.rating` ngoài 1 đến 5 bị MySQL từ chối ở mức database, không chỉ ở lớp validate của ứng dụng.

## Ràng buộc do ứng dụng bảo vệ, không phải database

Một số bất biến quan trọng không có ràng buộc ở mức database mà do code bảo đảm. Chi tiết nằm ở mục **Bất biến** của từng model và ở [transactions-and-locking.md](transactions-and-locking.md):

- `Product.quantity` bằng tổng `StockMovement.delta` (chỉ `moveStock` thay đổi tồn kho).
- `Order.status`, `Payment.status` và các trạng thái lưu bằng `VARCHAR` chỉ nhận giá trị hợp lệ (xem [enums.md](enums.md#trạng-thái-và-giá-trị-lưu-bằng-varchar)).
- Các bộ đếm (`CouponPolicy.usedCount`, `FlashSaleProductQuota.claimedUnits`) không vượt mức trần nhờ `UPDATE` có điều kiện.

## Nguồn

- [prisma/schema.prisma](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/prisma/schema.prisma): `@@id`, `@@unique`, `@unique`, `@@index`
- [prisma/migrations/20261021040546_add_product_reviews/migration.sql](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/prisma/migrations/20261021040546_add_product_reviews/migration.sql)
- [src/modules/inventory/inventory.service.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/inventory/inventory.service.ts): `moveStock`
