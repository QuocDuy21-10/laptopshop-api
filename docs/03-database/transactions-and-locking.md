# Transaction và cơ chế khoá

Tài liệu này trả lời: dữ liệu nào được bảo vệ khỏi ghi đồng thời, bằng cơ chế gì và ở file nào, để người sửa schema hoặc code ghi dữ liệu biết mình đang đứng trên bất biến nào.

> Đối chiếu code: main @ 0f1eab2 (2026-11-04)

Tài liệu này chỉ nói về góc nhìn dữ liệu. Luồng nghiệp vụ từng bước (checkout, thanh toán, bảo hành) sẽ được mô tả ở giai đoạn tài liệu nghiệp vụ.

## Các cơ chế đang dùng

| Cơ chế | Cách hoạt động | Dùng khi |
| --- | --- | --- |
| Transaction tương tác (`prisma.$transaction(async (tx) => …)`) | Nhiều bước đọc và ghi cùng thành công hoặc cùng thất bại | Hầu hết thao tác ghi nhiều bảng. Có 28 file trong `src/` dùng (không tính script, seed và demo seed) |
| Khoá hàng `SELECT … FOR UPDATE` | Giữ khoá hàng đến hết transaction; các transaction khác đụng cùng hàng phải chờ | Cần đọc rồi quyết định dựa trên trạng thái hiện tại, hoặc cần thứ tự xử lý cố định |
| Cập nhật có điều kiện (`updateMany` với `where` chứa điều kiện) | Điều kiện nằm trong chính câu `UPDATE`; `count === 0` nghĩa là thua cuộc đua | Bộ đếm có mức trần, chuyển trạng thái, khoá lạc quan |
| Khoá lạc quan bằng `version` | `where: { id, version }` rồi `version: { increment: 1 }` | Dòng do người dùng sửa qua nhiều request (phiếu nhập, yêu cầu bảo hành, ca xem xét thanh toán) |
| Lease trong database | Cột `leaseOwner` và `leaseExpiresAt`; giành quyền bằng `updateMany` có điều kiện | Việc nền chạy nhiều tiến trình (outbox, gửi thông báo, đối soát, đồng bộ ảnh) |
| Khoá phân tán trên Redis | `SET key token NX PX ttl`, gia hạn và nhả bằng Lua kiểm tra token | Vòng quét cảnh báo giá chỉ chạy ở một tiến trình tại một thời điểm |
| Unique làm khoá chống lặp | Chèn trùng khoá thì lỗi `P2002`, code đọc lại dòng đã thắng | Idempotency của đơn hàng, điều chỉnh kho, yêu cầu bảo hành, đồng bộ ảnh |
| Retry `P2034` | `withPrismaTransactionRetry` thử lại tối đa 3 lần khi xung đột ghi hoặc deadlock | Bọc quanh các transaction hay tranh chấp |

Không có nơi nào đặt mức cô lập transaction riêng (`isolationLevel`); tất cả dùng mức mặc định của MySQL InnoDB.

## Theo bảng dữ liệu

| Dữ liệu | Mối nguy | Cơ chế | File |
| --- | --- | --- | --- |
| `Product.quantity` | Bán vượt tồn kho khi nhiều đơn cùng đặt một sản phẩm | `UPDATE … WHERE quantity >= qty` trong `moveStock`; số dòng bị ảnh hưởng bằng 0 thì báo hết hàng. Sản phẩm trong đơn được khoá `FOR UPDATE` theo thứ tự `id` tăng dần để tránh deadlock | `src/modules/inventory/inventory.service.ts` (`moveStock`), `src/modules/orders/order-locks.ts` (`lockProductRows`) |
| `Product.quantity` và `StockMovement` | Tồn kho và sổ kho lệch nhau | Cả hai ghi trong cùng transaction của nơi gọi; kiểm tra bằng `pnpm run inventory:verify-ledger` | `src/modules/inventory/inventory.service.ts`, `src/modules/inventory/inventory.reconciliation.ts` |
| `Order` (checkout) | Đặt hàng hai lần khi client gửi lại | Unique `(userId, idempotencyKey)`; transaction đọc lại đơn thắng khi gặp trùng; retry `P2034` tối đa 3 lần; xoá giỏ trong cùng transaction và kiểm `count` | `src/modules/orders/orders.service.ts` (`placeOrder`) |
| `Order.status` | Hai thay đổi trạng thái đồng thời (cùng huỷ và hoàn kho hai lần) | `updateMany` với `where: { id, status: <đã đọc> }` | `src/modules/orders/orders.service.ts` (`changeStatus`) |
| `StockMovement` (điều chỉnh của admin) | Gửi lại cùng điều chỉnh | Unique `(actorId, idempotencyKey)` và `requestHash` | `src/modules/inventory/inventory.service.ts` (`adjustStock`) |
| `StockReceipt` | Ghi sổ phiếu hai lần, sửa phiếu đã ghi sổ | `updateMany` với `status = DRAFT` và `version`; retry `P2034` | `src/modules/inventory/inventory-receipts.service.ts` (`postReceipt`) |
| `CouponPolicy.usedCount`, `PromotionUserUsage.usedCount` | Dùng mã vượt `maxUses` hoặc `maxUsesPerUser` | `UPDATE … WHERE usedCount < max`; tạo dòng đếm mới bắt `P2002` rồi rơi về cập nhật có điều kiện | `src/modules/promotions/promotion-usage.ts` (`claimCouponUsage`) |
| `FlashSaleProductQuota.claimedUnits`, `FlashSaleUserUsage.claimedUnits` | Bán vượt hạn mức flash sale | Khoá hàng `promotions` theo thứ tự `id`, sắp xếp các yêu cầu theo `(promotionId, productId)` để tránh deadlock, rồi `UPDATE … WHERE claimedUnits <= total - quantity`; kiểm tra bằng `pnpm run promotions:verify-flash-sale` | `src/modules/promotions/flash-sale-quota.ts` (`claimFlashSaleQuotas`) |
| `Promotion` (đổi trạng thái, sửa) | Hai thao tác đồng thời trên cùng khuyến mãi | `updateMany` với `where: { id, state }` hoặc `where: { id, pricingVersion, activatedAt }` | `src/modules/promotions/promotions.service.ts` |
| `CatalogPriceWindow` | Hai lần dựng lại giá cùng lúc cho một sản phẩm | Khoá `products` theo thứ tự `id` (`FOR UPDATE`) trước khi ghi lại cửa sổ giá | `src/modules/pricing/catalog-price-projection.repository.ts` (`refreshCatalogPriceWindows`) |
| `Payment`, `PaymentWebhookEvent` | Cùng giao dịch đến hai lần (webhook và đối soát); xác nhận tiền và huỷ đua nhau | Unique `(provider, providerMode, providerEventId)` và `(…, providerTransactionKey)`; `updateMany` với `status IN (…)`; lỗi `PAYMENT_CONFIRMATION_RACE` khi thua | `src/modules/payments/payment-ingestion.service.ts` (`ingestPaymentTransaction`) |
| `Payment` (huỷ khi hết hạn) | Huỷ thanh toán khi tiền vừa về | Khoá hàng checkpoint (`FOR UPDATE`) để đọc bằng chứng đối soát nhất quán trong transaction; retry `P2034` | `src/modules/payments/payment-maintenance.service.ts` |
| `PaymentProviderCheckpoint` | Hai worker đối soát cùng lúc | Lease `leaseOwner` / `leaseExpiresAt` giành bằng `updateMany` có điều kiện | `src/modules/payments/payment-checkpoint.service.ts` |
| `PaymentReviewCase` | Hai admin xử lý cùng ca | `updateMany` với `status = OPEN` và `version`; retry `P2034` | `src/modules/payments/payment-review.service.ts` |
| `OutboxEvent` | Hai dispatcher phát cùng sự kiện | Lease: chọn lô chưa phát và chưa bị thuê, rồi từng dòng `updateMany` kèm lại điều kiện lease; đánh dấu kết quả chỉ khi còn là `leaseOwner` | `src/modules/outbox/outbox.repository.ts` (`claimOutboxBatch`, `markOutboxPublished`, `markOutboxFailed`) |
| `NotificationDelivery` | Gửi trùng một thông báo | Unique `dedupeKey` cho lần gửi và cho thông báo; lease khi xử lý; mọi cập nhật trạng thái có điều kiện `leaseOwner` | `src/modules/notifications/notification-delivery.service.ts` |
| `WorkerCheckpoint` | Hai tiến trình price-alert quét cùng lúc | `ownerEpoch` / `ownerToken` giành quyền bằng `updateMany` có điều kiện; thêm khoá Redis `SET NX PX` có gia hạn | `src/modules/price-alerts/price-alert.checkpoint.ts`, `src/modules/price-alerts/price-alert.lock.ts` |
| `WishlistItem` (giới hạn số mục) | Hai request cùng thêm làm vượt `WISHLIST_LIMIT` | Khoá hàng `users` của người dùng (`FOR UPDATE`) rồi đếm | `src/modules/wishlist/wishlist.service.ts` (`putWishlistItem`) |
| `Review` | Sửa, xoá, ẩn, đổi ảnh đồng thời | Khoá hàng `reviews` (`FOR UPDATE`) trước khi kiểm tra trạng thái; khoá lạc quan bằng `imageVersion` cho tập ảnh | `src/modules/reviews/reviews.service.ts`, `src/modules/reviews/review-images.service.ts`, `src/modules/reviews/review-helpful.service.ts`, `src/modules/reviews/review-replies.service.ts` |
| `ReviewImageSyncOperation` | Hai tiến trình đồng bộ ảnh cùng một thao tác | Unique `(userId, reviewId, idempotencyKey)`; lease; khoá hàng khi chuyển trạng thái | `src/modules/reviews/review-image-sync.service.ts`, `src/modules/reviews/review-image-sync.repository.ts` |
| `ServiceRequest`, `ServiceRequestItem` | Hai thay đổi trạng thái thiết bị cùng lúc, trạng thái tổng hợp lệch | Khoá hàng `service_request_items` và `service_requests` (`FOR UPDATE`), khoá lạc quan bằng `version`, tính lại trạng thái tổng hợp trong cùng transaction | `src/modules/after-sales/after-sales.events.ts`, `src/modules/after-sales/after-sales.actions.ts`, `src/modules/after-sales/after-sales.repository.ts` (`lockOrderDetails`) |
| `ServiceRequestAttachment` | Vượt 15 ảnh, tải lên trùng | Khoá hàng thiết bị trước khi đếm; unique `(serviceRequestItemId, uploadKey, uploadPosition)` | `src/modules/after-sales/after-sales.attachments.ts` |

## Giới hạn đã biết

- **Hai admin tự hạ quyền nhau cùng lúc** vẫn có thể khiến hệ thống không còn admin nào. Code chỉ chặn việc tự đổi vai trò của chính mình và ghi chú rõ đây là một lối tắt; khôi phục bằng seed hoặc `ADMIN_PASSWORD` (`src/modules/users/users.service.ts`).
- Vòng quét price-alert có hai lớp: khoá Redis và `WorkerCheckpoint` trong MySQL.

> **Suy luận:** khoá Redis có vai trò giảm tranh chấp, còn `WorkerCheckpoint` (`ownerEpoch`, `ownerToken`) mới là lớp bảo đảm khi Redis mất khoá; chưa kiểm chứng bằng thử nghiệm tranh chấp.
- Lệch giữa `onDelete` của schema và migration ở `PaymentReviewCase` được ghi ở [relationships.md](relationships.md#lệch-giữa-schema-và-migration).

## Nguồn

- [src/lib/prisma-retry.ts](../../src/lib/prisma-retry.ts): `withPrismaTransactionRetry`
- [src/modules/inventory/inventory.service.ts](../../src/modules/inventory/inventory.service.ts): `moveStock`, `adjustStock`
- [src/modules/inventory/inventory-receipts.service.ts](../../src/modules/inventory/inventory-receipts.service.ts): `postReceipt`
- [src/modules/orders/orders.service.ts](../../src/modules/orders/orders.service.ts): `placeOrder`, `changeStatus`
- [src/modules/orders/order-locks.ts](../../src/modules/orders/order-locks.ts): `lockProductRows`
- [src/modules/promotions/promotion-usage.ts](../../src/modules/promotions/promotion-usage.ts): `claimCouponUsage`
- [src/modules/promotions/flash-sale-quota.ts](../../src/modules/promotions/flash-sale-quota.ts): `claimFlashSaleQuotas`
- [src/modules/pricing/catalog-price-projection.repository.ts](../../src/modules/pricing/catalog-price-projection.repository.ts): `refreshCatalogPriceWindows`
- [src/modules/payments/payment-ingestion.service.ts](../../src/modules/payments/payment-ingestion.service.ts): `ingestPaymentTransaction`
- [src/modules/payments/payment-maintenance.service.ts](../../src/modules/payments/payment-maintenance.service.ts)
- [src/modules/payments/payment-checkpoint.service.ts](../../src/modules/payments/payment-checkpoint.service.ts)
- [src/modules/payments/payment-review.service.ts](../../src/modules/payments/payment-review.service.ts)
- [src/modules/outbox/outbox.repository.ts](../../src/modules/outbox/outbox.repository.ts): `claimOutboxBatch`
- [src/modules/notifications/notification-delivery.service.ts](../../src/modules/notifications/notification-delivery.service.ts)
- [src/modules/price-alerts/price-alert.checkpoint.ts](../../src/modules/price-alerts/price-alert.checkpoint.ts)
- [src/modules/price-alerts/price-alert.lock.ts](../../src/modules/price-alerts/price-alert.lock.ts)
- [src/modules/wishlist/wishlist.service.ts](../../src/modules/wishlist/wishlist.service.ts): `putWishlistItem`
- [src/modules/reviews/reviews.service.ts](../../src/modules/reviews/reviews.service.ts)
- [src/modules/reviews/review-image-sync.service.ts](../../src/modules/reviews/review-image-sync.service.ts)
- [src/modules/after-sales/after-sales.events.ts](../../src/modules/after-sales/after-sales.events.ts)
- [src/modules/after-sales/after-sales.attachments.ts](../../src/modules/after-sales/after-sales.attachments.ts)
- [src/modules/users/users.service.ts](../../src/modules/users/users.service.ts)
