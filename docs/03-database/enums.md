# Enum

Tài liệu này trả lời: schema có những enum nào, mỗi giá trị nghĩa là gì và cột nào dùng enum đó.

> Đối chiếu code: main @ 0f1eab2 (2026-11-04)

Có 30 enum Prisma, tất cả được lưu thành kiểu `ENUM` của MySQL. Nhiều trạng thái khác trong schema **không** phải enum mà lưu bằng `VARCHAR` (xem [mục cuối](#trạng-thái-và-giá-trị-lưu-bằng-varchar)); thêm giá trị cho enum cần migration, còn thêm giá trị cho `VARCHAR` chỉ cần sửa code.

## Danh sách enum

### `ReviewStatus`

Dùng ở: `Review.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PUBLISHED` | Đang hiển thị công khai. |
| `HIDDEN` | Admin đã ẩn, kèm `hiddenReason`. |

### `ReviewImageStatus`

Dùng ở: `ReviewImage.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PENDING` | Đã tạo dòng, chưa xác nhận file đã lên storage. |
| `READY` | File đã lên storage, ảnh dùng được. |
| `DELETING` | Đã đánh dấu xoá; file sẽ bị xoá khỏi storage rồi ghi `storageDeletedAt`. |

### `ReviewImageSyncStatus`

Dùng ở: `ReviewImageSyncOperation.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PROCESSING` | Đang được một tiến trình giữ lease xử lý. |
| `WAITING_RETRY` | Gặp lỗi tạm thời, chờ thử lại. |
| `SUCCEEDED` | Đồng bộ xong, kết quả lưu ở `result`. |
| `FAILED` | Thất bại, mã lỗi ở `errorCode`. |

### `PromotionKind`

Dùng ở: `Promotion.kind`

| Giá trị | Ý nghĩa |
| --- | --- |
| `COUPON` | Mã giảm giá khách nhập khi đặt hàng; có `CouponPolicy`. |
| `AUTOMATIC` | Khuyến mãi tự động theo sản phẩm; có `AutomaticPromotionPolicy`. |
| `FLASH_SALE` | Flash sale có hạn mức; có `FlashSalePolicy` và `FlashSaleProductQuota`. |

### `PromotionState`

Dùng ở: `Promotion.state`

| Giá trị | Ý nghĩa |
| --- | --- |
| `DRAFT` | Mới tạo, chưa kích hoạt. |
| `ACTIVE` | Đang hiệu lực (còn phụ thuộc khoảng `startsAt`, `endsAt`). |
| `PAUSED` | Tạm dừng, có thể tiếp tục. |
| `ENDED` | Đã kết thúc. |

### `DiscountKind`

Dùng ở: `Promotion.discountKind`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PERCENT` | `discountValue` là phần trăm. |
| `FIXED` | `discountValue` là số tiền cố định. |

### `CouponScope`

Dùng ở: `CouponPolicy.scope`

| Giá trị | Ý nghĩa |
| --- | --- |
| `ORDER` | Mã tính trên cả đơn. |
| `PRODUCT` | Mã chỉ tính trên các sản phẩm trong `PromotionProduct`. |

### `RedemptionStatus`

Dùng ở: `PromotionRedemption.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `APPLIED` | Mã đang được áp cho đơn. |
| `REVERSED` | Đã đảo (đơn bị huỷ), trả lại lượt dùng. |

### `FlashSaleAllocationStatus`

Dùng ở: `FlashSaleAllocation.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `CLAIMED` | Đang giữ suất cho dòng đơn. |
| `RELEASED` | Đã nhả suất (đơn bị huỷ). |

### `PriceAlertMode`

Dùng ở: `WishlistItem.alertMode`, `WishlistItem.lastAlertMode`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PERCENT_DROP` | Báo khi giá giảm so với `referencePrice`. |
| `TARGET_PRICE` | Báo khi giá chạm `targetPrice`, rồi tự tắt cảnh báo. |

### `WarrantyPolicySource`

Dùng ở: `OrderDetail.warrantyPolicySource`

| Giá trị | Ý nghĩa |
| --- | --- |
| `CHECKOUT_SNAPSHOT` | Số tháng bảo hành được chụp lúc đặt hàng. |
| `CURRENT_PRODUCT_POLICY_BACKFILL` | Dòng đơn cũ được điền bù theo chính sách hiện hành của sản phẩm; không chắc đúng với lúc mua nên cần xác minh. |
| `UNAVAILABLE` | Không có thông tin bảo hành (mặc định cho dòng cũ); cần xác minh. |

### `WarrantyCoverage`

Dùng ở: `ServiceRequestItem.coverageAtCreation`

| Giá trị | Ý nghĩa |
| --- | --- |
| `IN_WARRANTY` | Còn bảo hành. |
| `OUT_OF_WARRANTY` | Hết bảo hành. |
| `NO_WARRANTY` | Sản phẩm không có bảo hành. |
| `REQUIRES_VERIFICATION` | Chưa đủ dữ liệu, admin phải xác minh. |

### `WarrantyVerificationDecision`

Dùng ở: `WarrantyVerification.decision`

| Giá trị | Ý nghĩa |
| --- | --- |
| `IN_WARRANTY` | Admin kết luận còn bảo hành. |
| `OUT_OF_WARRANTY` | Admin kết luận hết bảo hành. |
| `NO_WARRANTY` | Admin kết luận không có bảo hành. |
| `UNVERIFIABLE` | Không xác minh được; vẫn tính là cần xác minh. |

### `ServiceRequestType`

Dùng ở: `ServiceRequest.type`

| Giá trị | Ý nghĩa |
| --- | --- |
| `WARRANTY` | Yêu cầu bảo hành. |
| `TECHNICAL_SUPPORT` | Yêu cầu hỗ trợ kỹ thuật (có thể có báo giá). |

### `ServiceRequestStatus`

Dùng ở: `ServiceRequest.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `SUBMITTED` | Mọi thiết bị đều mới gửi. |
| `REVIEWING` | Có thiết bị đang xem xét, các thiết bị còn lại mới gửi. |
| `IN_PROGRESS` | Đang xử lý (trường hợp còn lại). |
| `AWAITING_CUSTOMER` | Mọi thiết bị đang chờ khách thao tác. |
| `PARTIALLY_COMPLETED` | Một số thiết bị đã ở trạng thái kết thúc, số còn lại chưa. |
| `CLOSED` | Mọi thiết bị đã ở trạng thái kết thúc. |

### `ServiceRequestItemStatus`

Dùng ở: `ServiceRequestItem.status`, `ServiceRequestEvent.fromStatus`, `ServiceRequestEvent.toStatus`

| Giá trị | Ý nghĩa |
| --- | --- |
| `SUBMITTED` | Khách mới gửi. |
| `REVIEWING` | Nhân viên đang xem xét; cũng là trạng thái quay lại khi khách khiếu nại việc hoàn tất. |
| `APPROVED` | Đã chấp nhận yêu cầu. |
| `AWAITING_ITEM` | Chờ khách gửi máy tới (chỉ với bảo hành, hoặc sau khi khách chấp nhận báo giá). |
| `RECEIVED` | Đã nhận máy. |
| `DIAGNOSING` | Đang kiểm tra. |
| `AWAITING_QUOTE_DECISION` | Đã gửi báo giá, chờ khách quyết định (trạng thái chờ khách). |
| `IN_SERVICE` | Đang sửa chữa. |
| `READY_FOR_RETURN` | Sẵn sàng trả máy. |
| `RETURNED` | Đã trả máy, chờ khách xác nhận trong 7 ngày (trạng thái chờ khách). |
| `RESOLVED` | Đã xử lý xong không cần trả máy, chờ khách xác nhận trong 7 ngày (trạng thái chờ khách). |
| `CLOSED` | Đã đóng (trạng thái kết thúc). |
| `REJECTED` | Bị từ chối khi xem xét (trạng thái kết thúc). |
| `CANCELLED` | Khách huỷ ở giai đoạn đầu (trạng thái kết thúc). |

### `ServiceItemCloseReason`

Dùng ở: `ServiceRequestItem.closeReason`

| Giá trị | Ý nghĩa |
| --- | --- |
| `CUSTOMER_CONFIRMED` | Khách xác nhận hoàn tất. |
| `CUSTOMER_CONFIRMATION_TIMEOUT` | Quá hạn xác nhận 168 giờ, hệ thống tự đóng. |
| `ADMINISTRATIVE` | Admin đóng, kèm lý do bắt buộc. |
| `REJECTED` | Đóng do bị từ chối. |
| `CUSTOMER_CANCELLED` | Đóng do khách huỷ. |

### `ServiceEventKind`

Dùng ở: `ServiceRequestEvent.kind`

| Giá trị | Ý nghĩa |
| --- | --- |
| `REQUEST_CREATED` | Yêu cầu được tạo. |
| `STATUS_CHANGED` | Trạng thái thiết bị đổi (`fromStatus`, `toStatus`). |
| `PUBLIC_MESSAGE` | Tin nhắn khách và nhân viên đều thấy. |
| `INTERNAL_NOTE` | Ghi chú nội bộ, chỉ nhân viên thấy. |
| `ASSIGNED` | Giao yêu cầu cho nhân viên. |
| `QUOTE_SENT` | Gửi báo giá. |
| `QUOTE_DECIDED` | Khách chấp nhận hoặc từ chối báo giá. |
| `DEVICE_RETURNED` | Đã trả máy. |
| `CUSTOMER_CONFIRMED` | Khách xác nhận hoàn tất. |
| `COMPLETION_DISPUTED` | Khách khiếu nại việc hoàn tất, thiết bị quay lại `REVIEWING`. |
| `AUTO_CLOSED` | Hệ thống tự đóng do quá hạn xác nhận. |
| `ADMIN_CLOSED` | Admin đóng. |
| `FOLLOW_UP_CREATED` | Khách tạo yêu cầu tiếp nối. |
| `WARRANTY_VERIFIED` | Admin ghi kết luận bảo hành. |
| `ATTACHMENT_REDACTED` | Một ảnh đính kèm bị gỡ (đánh dấu `DELETING`) bởi người thực hiện. |

### `ServiceEventVisibility`

Dùng ở: `ServiceRequestEvent.visibility`, `ServiceRequestAttachment.visibility`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PUBLIC` | Khách cũng thấy. |
| `INTERNAL` | Chỉ nhân viên thấy. |

### `ServiceAttachmentStatus`

Dùng ở: `ServiceRequestAttachment.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PENDING` | Đã tạo dòng, chưa xác nhận file đã lên storage. |
| `READY` | File đã lên storage, ảnh dùng được. |
| `DELETING` | Đã đánh dấu xoá, chờ xoá file khỏi storage. |

### `ServiceQuoteStatus`

Dùng ở: `ServiceQuote.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `SENT` | Đã gửi, chờ khách quyết định. |
| `ACCEPTED` | Khách chấp nhận. |
| `DECLINED` | Khách từ chối. |
| `EXPIRED` | Quá `validUntil` mà khách chưa quyết định. |
| `SUPERSEDED` | Bị báo giá mới thay thế. |

### `NotificationType`

Dùng ở: `Notification.type`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PRICE_DROP` | Sản phẩm trong wishlist giảm giá. |
| `AFTER_SALES_MESSAGE` | Có tin nhắn mới trong yêu cầu bảo hành. |
| `AFTER_SALES_STATUS_CHANGED` | Trạng thái yêu cầu bảo hành đổi. |
| `AFTER_SALES_QUOTE_SENT` | Có báo giá mới. |
| `AFTER_SALES_CONFIRMATION_REQUIRED` | Cần khách xác nhận hoàn tất. |
| `AFTER_SALES_AUTO_CLOSED` | Yêu cầu tự đóng do quá hạn xác nhận. |

### `NotificationPriceSource`

Dùng ở: `Notification.priceSource`

| Giá trị | Ý nghĩa |
| --- | --- |
| `LIST_PRICE` | Giá niêm yết. |
| `AUTOMATIC` | Giá sau khuyến mãi tự động. |
| `FLASH_SALE` | Giá flash sale. |

### `NotificationChannel`

Dùng ở: `NotificationDelivery.channel`

| Giá trị | Ý nghĩa |
| --- | --- |
| `EMAIL` | Gửi email. |
| `WEB_PUSH` | Gửi thông báo đẩy trình duyệt. |

### `NotificationDeliveryParent`

Dùng ở: `NotificationDelivery.parentType`

| Giá trị | Ý nghĩa |
| --- | --- |
| `NOTIFICATION` | Cha là một `Notification`. |
| `EMAIL_VERIFICATION` | Cha là một `EmailVerificationChallenge` (gửi mã OTP). |

### `NotificationDeliveryStatus`

Dùng ở: `NotificationDelivery.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PENDING` | Mới tạo, chờ xử lý. |
| `PROCESSING` | Đang được tiến trình giữ lease xử lý. |
| `DELIVERED` | Đã gửi thành công (trạng thái kết thúc). |
| `RETRYING` | Lỗi tạm thời, chờ thử lại ở `nextAttemptAt`. |
| `FAILED` | Lỗi không thể thử lại, hoặc không có provider cho kênh. |
| `DEAD` | Lỗi có thể thử lại nhưng đã hết số lần thử tối đa. |
| `CANCELLED` | Bị huỷ, ví dụ giá trong thông báo đã hết hạn (trạng thái kết thúc). |
| `SUPPRESSED` | Bị chặn vì người dùng không còn đồng ý nhận (trạng thái kết thúc). |

### `OutboxEventType`

Dùng ở: `OutboxEvent.eventType`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PRICE_REEVALUATION_REQUESTED` | Đánh giá lại cảnh báo giá; vào queue `pricing-evaluation-v1`. |
| `NOTIFICATION_DELIVERY_REQUESTED` | Gửi một lần gửi thông báo; vào queue `notification-delivery-v1`. |
| `AFTER_SALES_MILESTONE_REQUESTED` | Xử lý mốc thời gian của yêu cầu bảo hành; vào queue `after-sales-milestone-v1`. |
| `AFTER_SALES_ATTACHMENT_DELETE_REQUESTED` | Xoá ảnh đính kèm bảo hành khỏi storage; vào queue `after-sales-milestone-v1`. |

### `EmailChallengePurpose`

Dùng ở: `EmailVerificationChallenge.purpose`

| Giá trị | Ý nghĩa |
| --- | --- |
| `EMAIL_VERIFICATION` | Mã xác minh email, hiệu lực 10 phút. |
| `PASSWORD_RESET` | Mã đặt lại mật khẩu, hiệu lực 15 phút. |

### `HomeBannerPlacement`

Dùng ở: `HomeBanner.placement`

| Giá trị | Ý nghĩa |
| --- | --- |
| `HERO` | Banner chính; có thể có nút chính, nút phụ và nhãn (`badges`). Nút và đường dẫn tương ứng phải được đặt cùng nhau. |
| `SIDE` | Banner phụ; không được có `ctaText`, `secondaryCtaText`, `secondaryLinkUrl` và `badges`. |

### `NewsletterStatus`

Dùng ở: `NewsletterSubscriber.status`

| Giá trị | Ý nghĩa |
| --- | --- |
| `PENDING` | Chờ xác nhận qua email. |
| `CONFIRMED` | Đã xác nhận. |
| `UNSUBSCRIBED` | Đã huỷ đăng ký. |

## Trạng thái và giá trị lưu bằng VARCHAR

Các cột sau là chuỗi, không có ràng buộc ở mức database; tập giá trị hợp lệ do code kiểm soát.

| Cột | Giá trị | Định nghĩa trong code |
| --- | --- | --- |
| `Order.status` | `PENDING`, `SHIPPING`, `COMPLETED`, `CANCELLED` | `ORDER_STATUS` trong `src/modules/orders/order-status.ts` |
| `Order.paymentStatus` | `PAYMENT_UNPAID`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED` | `PAYMENT_STATUS` trong `src/modules/orders/order-status.ts` |
| `Order.paymentMethod` | `COD`, `BANK_TRANSFER`, `FREE` | `src/modules/orders/orders.schema.ts`, `src/modules/orders/orders.service.ts` |
| `Payment.status` | `PENDING`, `VERIFYING`, `SUCCEEDED`, `EXPIRED`, `CANCELLED`, `REVIEW_REQUIRED` | `PAYMENT_STATUS` trong `src/modules/payments/payment-status.ts` |
| `PaymentWebhookEvent.status` | `MATCHED`, `REVIEW_REQUIRED`, `RESOLVED` | `PAYMENT_EVENT_STATUS` |
| `PaymentWebhookEvent.source` | `WEBHOOK`, `RECONCILIATION` | `PaymentTransactionSource` trong `src/modules/payments/payment-ingestion.service.ts` |
| `PaymentWebhookEvent.direction` | `IN`, `OUT` | `src/modules/payments/payment-reconcile.ts` |
| `PaymentWebhookEvent.reviewReason` | `UNKNOWN_CODE`, `AMOUNT_MISMATCH`, `WRONG_ACCOUNT`, `OUTBOUND`, `LATE_PAYMENT`, `INVALID_PAYMENT_STATE`, `PROVIDER_MISMATCH` | `PAYMENT_REVIEW_REASON` |
| `PaymentReviewCase.status` | `OPEN`, `RESOLVED` | `src/modules/payments/payment-review.service.ts` |
| `PaymentReviewCase.reason` | `RECONCILIATION_INCONCLUSIVE` | `src/modules/payments/payment-maintenance.service.ts` |
| `PaymentReviewCase.resolution` | `PAYMENT_CONFIRMED`, `RELEASED_UNVERIFIED` | `src/modules/payments/payment-ingestion.service.ts`, `payment-review.service.ts` |
| `PaymentReviewAction.action` | `EXTEND_HOLD`, `RELEASE_STOCK` | `src/modules/payments/payment-review.service.ts` |
| `StockMovement.reason` | `OPENING`, `INITIAL`, `ORDER`, `ORDER_CANCEL`, `RESTOCK`, `CORRECTION` | `STOCK_REASON` trong `src/modules/inventory/inventory.schema.ts` |
| `StockReceipt.status` | `DRAFT`, `POSTED` | `RECEIPT_STATUS` trong `src/modules/inventory/inventory-receipts.schema.ts` |
| `CatalogPriceWindow.source` | `LIST_PRICE`, `AUTOMATIC` | `src/modules/pricing/catalog-price-timeline.ts` |
| `NotificationDeliveryAudit.action` | `RETRY` | `src/modules/notifications/admin-notifications.service.ts` |
| `WorkerHeartbeat.status` | `HEALTHY`, `STOPPING` | `src/workers/after-sales-worker.ts` và các worker khác |
| `User.accountType` | `SYSTEM`, `GOOGLE`, `GITHUB` | `ACCOUNT_TYPE` trong `src/config/constant.ts` |

## Nguồn

- [prisma/schema.prisma](../../prisma/schema.prisma): các khối `enum`
- [src/modules/orders/order-status.ts](../../src/modules/orders/order-status.ts)
- [src/modules/payments/payment-status.ts](../../src/modules/payments/payment-status.ts)
- [src/modules/inventory/inventory.schema.ts](../../src/modules/inventory/inventory.schema.ts)
- [src/modules/after-sales/after-sales.status.ts](../../src/modules/after-sales/after-sales.status.ts)
- [src/config/constant.ts](../../src/config/constant.ts)
