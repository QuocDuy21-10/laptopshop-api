# Quan hệ giữa các bảng

Tài liệu này trả lời: các bảng tham chiếu nhau thế nào, xoá một dòng cha thì dòng con ra sao và nhóm nào phụ thuộc nhóm nào.

> Đối chiếu code: main @ 0f1eab2 (2026-11-04)

## Cách đọc

- Mỗi quan hệ là một khoá ngoại do `@relation(fields: [...])` khai báo. Khoá ngoại nằm ở bảng **con** và trỏ tới bảng **cha**.
- Khi `schema.prisma` không ghi `onDelete`, Prisma dùng mặc định: quan hệ bắt buộc là `Restrict`, quan hệ tuỳ chọn (cột cho phép rỗng) là `SetNull`.
- Danh sách theo từng bảng, kèm cột khoá ngoại và index, nằm trong mục **Quan hệ** của từng model ở [contexts/](contexts/). ERD theo nhóm cũng ở đó; ERD tổng quan ở [README.md](README.md).
- Tài liệu này không nhắc lại mọi quan hệ một-nhiều (mặc định khi khoá ngoại không unique); chỉ liệt kê riêng các quan hệ một-một.

## Kiểm tra với migration

`onDelete` mà Prisma suy ra từ schema được đối chiếu với `ON DELETE` của khoá ngoại cuối cùng trong `prisma/migrations/` cho cả 93 quan hệ. 92 quan hệ khớp; 1 quan hệ lệch, nêu ở [phần lệch](#lệch-giữa-schema-và-migration).

## Hành vi khi xoá dòng cha

Có 93 khoá ngoại: 15 `Cascade`, 17 `SetNull`, 61 `Restrict`.

### `Cascade`

Xoá dòng cha thì xoá luôn các dòng con.

| Dòng con | Dòng cha | Nguồn của giá trị |
| --- | --- | --- |
| `WishlistItem.userId` | `User` | Khai báo trong schema |
| `WishlistItem.productId` | `Product` | Khai báo trong schema |
| `Notification.userId` | `User` | Khai báo trong schema |
| `NotificationPreference.userId` | `User` | Khai báo trong schema |
| `EmailVerificationChallenge.userId` | `User` | Khai báo trong schema |
| `PushSubscription.userId` | `User` | Khai báo trong schema |
| `NotificationDelivery.notificationId` | `Notification` | Khai báo trong schema |
| `NotificationDelivery.emailVerificationChallengeId` | `EmailVerificationChallenge` | Khai báo trong schema |
| `NotificationDelivery.pushSubscriptionId` | `PushSubscription` | Khai báo trong schema |
| `NotificationDeliveryAudit.deliveryId` | `NotificationDelivery` | Khai báo trong schema |
| `ServiceQuoteLine.quoteId` | `ServiceQuote` | Khai báo trong schema |
| `CatalogPriceWindow.productId` | `Product` | Khai báo trong schema |
| `RefreshToken.userId` | `User` | Khai báo trong schema |
| `PaymentReviewAction.reviewCaseId` | `PaymentReviewCase` | Khai báo trong schema |
| `StockReceiptItem.receiptId` | `StockReceipt` | Khai báo trong schema |

### `SetNull`

Xoá dòng cha thì đặt cột khoá ngoại của dòng con về rỗng; dòng con được giữ.

| Dòng con | Dòng cha | Nguồn của giá trị |
| --- | --- | --- |
| `Notification.productId` | `Product` | Khai báo trong schema |
| `Notification.serviceRequestId` | `ServiceRequest` | Khai báo trong schema |
| `NotificationDeliveryAudit.actorId` | `User` | Khai báo trong schema |
| `ServiceRequest.assignedToId` | `User` | Khai báo trong schema |
| `ServiceRequest.previousRequestId` | `ServiceRequest` | Khai báo trong schema |
| `ServiceRequestEvent.serviceRequestItemId` | `ServiceRequestItem` | Khai báo trong schema |
| `ServiceRequestEvent.actorId` | `User` | Khai báo trong schema |
| `ServiceRequestAttachment.serviceRequestItemId` | `ServiceRequestItem` | Khai báo trong schema |
| `Review.moderatedById` | `User` | Khai báo trong schema |
| `ReviewImage.syncOperationId` | `ReviewImageSyncOperation` | Khai báo trong schema |
| `OrderStatusHistory.actorId` | `User` | Khai báo trong schema |
| `PaymentWebhookEvent.paymentId` | `Payment` | Mặc định của Prisma |
| `PaymentWebhookEvent.resolvedById` | `User` | Khai báo trong schema |
| `PaymentReviewCase.resolvedById` | `User` | Khai báo trong schema |
| `StockMovement.orderId` | `Order` | Khai báo trong schema |
| `StockMovement.actorId` | `User` | Khai báo trong schema |
| `StockReceipt.postedById` | `User` | Mặc định của Prisma |

### `Restrict`

Không xoá được dòng cha khi còn dòng con tham chiếu. Gom theo bảng cha:

| Bảng cha | Các cột con tham chiếu |
| --- | --- |
| `User` (19) | `Cart.userId`, `Order.userId`, `ServiceRequest.userId`, `WarrantyVerification.verifiedById`, `ServiceRequestAttachment.uploadedById`, `ServiceQuote.createdById`, `Promotion.createdById`, `Promotion.updatedById`, `PromotionUserUsage.userId`, `PromotionRedemption.userId`, `FlashSaleUserUsage.userId`, `FlashSaleAllocation.userId`, `Review.userId`, `ReviewImageSyncOperation.userId`, `ReviewHelpful.userId`, `ReviewReply.createdById`, `ReviewReply.updatedById`, `PaymentReviewAction.actorId`, `StockReceipt.createdById` |
| `Promotion` (10) | `Order.couponPromotionId`, `OrderDetail.automaticPromotionId`, `CatalogPriceWindow.automaticPromotionId`, `CouponPolicy.promotionId`, `AutomaticPromotionPolicy.promotionId`, `PromotionProduct.promotionId`, `PromotionUserUsage.promotionId`, `PromotionRedemption.promotionId`, `FlashSalePolicy.promotionId`, `FlashSaleProductQuota.promotionId` |
| `Product` (7) | `CartDetail.productId`, `OrderDetail.productId`, `PromotionProduct.productId`, `FlashSaleProductQuota.productId`, `Review.productId`, `StockMovement.productId`, `StockReceiptItem.productId` |
| `Order` (5) | `OrderDetail.orderId`, `PromotionRedemption.orderId`, `FlashSaleAllocation.orderId`, `OrderStatusHistory.orderId`, `Payment.orderId` |
| `OrderDetail` (4) | `ServiceRequestItem.orderDetailId`, `WarrantyVerification.orderDetailId`, `FlashSaleAllocation.orderDetailId`, `Review.orderDetailId` |
| `Review` (4) | `ReviewImage.reviewId`, `ReviewImageSyncOperation.reviewId`, `ReviewHelpful.reviewId`, `ReviewReply.reviewId` |
| `ServiceRequest` (3) | `ServiceRequestItem.serviceRequestId`, `ServiceRequestEvent.serviceRequestId`, `ServiceRequestAttachment.serviceRequestId` |
| `FlashSaleProductQuota` (2) | `FlashSaleUserUsage.promotionId, productId`, `FlashSaleAllocation.promotionId, productId` |
| `ServiceRequestItem` (2) | `WarrantyVerification.serviceRequestItemId`, `ServiceQuote.serviceRequestItemId` |
| `Cart` (1) | `CartDetail.cartId` |
| `FlashSalePolicy` (1) | `FlashSaleProductQuota.promotionId` |
| `Payment` (1) | `PaymentReviewCase.paymentId` (**DB thực tế là `CASCADE`**, xem [phần lệch](#lệch-giữa-schema-và-migration)) |
| `Role` (1) | `User.roleId` |
| `StockReceipt` (1) | `StockMovement.receiptId` |

### Quan hệ một-một

Khoá ngoại là khoá chính hoặc có unique nên mỗi dòng cha có tối đa một dòng con.

| Dòng con | Dòng cha |
| --- | --- |
| `NotificationPreference.userId` | `User` |
| `Cart.userId` | `User` |
| `PromotionRedemption.orderId` | `Order` |
| `FlashSaleAllocation.orderDetailId` | `OrderDetail` |
| `Review.orderDetailId` | `OrderDetail` |
| `ReviewReply.reviewId` | `Review` |
| `Payment.orderId` | `Order` |
| `PaymentReviewCase.paymentId` | `Payment` |

## Quan hệ giữa các nhóm

53 khoá ngoại đi qua ranh giới nhóm. `A → B` nghĩa là bảng của nhóm A giữ khoá ngoại trỏ tới bảng của nhóm B.

| Từ nhóm | Tới nhóm | Số khoá ngoại |
| --- | --- | --- |
| [after-sales](contexts/after-sales.md) | [identity-accounts](contexts/identity-accounts.md) | 6 |
| [catalog-reviews](contexts/catalog-reviews.md) | [identity-accounts](contexts/identity-accounts.md) | 6 |
| [messaging-ops](contexts/messaging-ops.md) | [identity-accounts](contexts/identity-accounts.md) | 6 |
| [promotions-pricing](contexts/promotions-pricing.md) | [identity-accounts](contexts/identity-accounts.md) | 6 |
| [inventory](contexts/inventory.md) | [identity-accounts](contexts/identity-accounts.md) | 3 |
| [payments](contexts/payments.md) | [identity-accounts](contexts/identity-accounts.md) | 3 |
| [promotions-pricing](contexts/promotions-pricing.md) | [catalog-reviews](contexts/catalog-reviews.md) | 3 |
| [promotions-pricing](contexts/promotions-pricing.md) | [shopping-orders](contexts/shopping-orders.md) | 3 |
| [shopping-orders](contexts/shopping-orders.md) | [identity-accounts](contexts/identity-accounts.md) | 3 |
| [after-sales](contexts/after-sales.md) | [shopping-orders](contexts/shopping-orders.md) | 2 |
| [inventory](contexts/inventory.md) | [catalog-reviews](contexts/catalog-reviews.md) | 2 |
| [messaging-ops](contexts/messaging-ops.md) | [catalog-reviews](contexts/catalog-reviews.md) | 2 |
| [shopping-orders](contexts/shopping-orders.md) | [catalog-reviews](contexts/catalog-reviews.md) | 2 |
| [shopping-orders](contexts/shopping-orders.md) | [promotions-pricing](contexts/promotions-pricing.md) | 2 |
| [catalog-reviews](contexts/catalog-reviews.md) | [shopping-orders](contexts/shopping-orders.md) | 1 |
| [inventory](contexts/inventory.md) | [shopping-orders](contexts/shopping-orders.md) | 1 |
| [messaging-ops](contexts/messaging-ops.md) | [after-sales](contexts/after-sales.md) | 1 |
| [payments](contexts/payments.md) | [shopping-orders](contexts/shopping-orders.md) | 1 |


## Lệch giữa schema và migration

`PaymentReviewCase.paymentId` → `Payment`:

- `schema.prisma` không khai báo `onDelete`, nên Prisma coi đây là `Restrict` (quan hệ bắt buộc).
- Migration `20261024150000_checkout_qr_review_remediation` tạo khoá ngoại với `ON DELETE CASCADE`, và không có migration nào sau đó đổi lại.

Hệ quả: trên database thật, xoá một `Payment` sẽ xoá luôn `PaymentReviewCase` của nó, trong khi schema cho thấy sẽ bị chặn. Tài liệu này mô tả cả hai nguồn và không tự quyết cách thống nhất (khai báo `onDelete: Cascade` trong schema, hoặc đổi khoá ngoại bằng migration).

> **Suy luận:** chưa chạy `prisma migrate diff` để xác nhận; kết luận dựa trên đọc schema và SQL của migration.

## Nguồn

- [prisma/schema.prisma](../../prisma/schema.prisma): các `@relation`
- [prisma/migrations/](../../prisma/migrations/): `ON DELETE` của từng khoá ngoại
- [prisma/migrations/20261024150000_checkout_qr_review_remediation/migration.sql](../../prisma/migrations/20261024150000_checkout_qr_review_remediation/migration.sql)
