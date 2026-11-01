# Thuật ngữ

Tài liệu này trả lời: các thuật ngữ riêng của dự án nghĩa là gì và tìm chúng ở đâu trong code.

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

Định nghĩa dưới đây chỉ nêu ý nghĩa tổng quát; chi tiết nghiệp vụ sẽ có ở các giai đoạn tài liệu sau.

| Thuật ngữ | Nghĩa trong LaptopShop | Nơi xuất hiện |
| --- | --- | --- |
| Bounded context | Một nhóm module nghiệp vụ gắn kết, ví dụ Payments hoặc Inventory | [business-domain.md](business-domain.md) |
| Idempotency-Key | Header client gửi kèm khi đặt hàng; gửi lại cùng key và cùng nội dung thì nhận lại kết quả cũ thay vì tạo đơn thứ hai. Giá trị là chuỗi 1 đến 64 ký tự | `src/lib/idempotency.ts` (`idempotencyKeyHeader`, `sha256Canonical`), `src/modules/orders/` |
| Outbox | Bảng `outbox_events` lưu sự kiện cần phát đi, ghi cùng transaction với dữ liệu nghiệp vụ, rồi một tiến trình riêng đọc và đẩy vào hàng đợi | `src/modules/outbox/`, `OutboxEvent` trong `prisma/schema.prisma` |
| Dedupe key | Khoá duy nhất `dedupeKey` của một sự kiện outbox để không phát trùng | `OutboxEvent.dedupeKey` |
| Lease | Quyền xử lý tạm thời: một tiến trình "thuê" một dòng trong thời gian giới hạn (`leaseOwner`, `leaseExpiresAt`) để các tiến trình khác không xử lý trùng | `OutboxEvent`, `OUTBOX_LEASE_MS`, `PAYMENT_RECONCILIATION_LEASE_MS` |
| Heartbeat | Bản ghi định kỳ của worker vào bảng `WorkerHeartbeat` để biết worker còn sống | `src/modules/workers/worker-heartbeat.service.ts` |
| Stock ledger / `StockMovement` | Sổ kho: mỗi biến động tồn kho là một dòng có `delta`, `balanceBefore`, `balanceAfter`, `reason`, và có thể gắn đơn hàng hoặc người thực hiện | `StockMovement` trong schema, `src/scripts/verify-stock-ledger.ts` |
| Price window / `CatalogPriceWindow` | Khoảng thời gian `validFrom` đến `validUntil` mà một sản phẩm có giá niêm yết `listPrice` và giá hiệu lực `effectiveCatalogPrice` | `CatalogPriceWindow` trong schema, `src/modules/pricing/` |
| Flash sale quota | Hạn mức đơn vị bán theo từng sản phẩm trong một chương trình flash sale (`totalQuota`, `claimedUnits`, `maxUnitsPerUser`) | `FlashSaleProductQuota` trong schema, `src/modules/promotions/flash-sale-quota.ts` |
| Coupon | Khuyến mãi áp bằng mã khi đặt hàng | `src/modules/promotions/` |
| Reconciliation (đối soát) | Worker so khớp giao dịch của nhà cung cấp thanh toán với đơn và thanh toán trong hệ thống | `src/workers/payment-worker.ts`, `src/modules/payments/reconciliation.service.ts` |
| Payment review case | Ca thanh toán không tự xử lý được, chuyển cho admin xem xét (`PaymentReviewCase`, trạng thái mặc định `OPEN`) | `src/modules/payments/`, route `/admin/payment-review-cases` |
| Webhook raw body | Webhook thanh toán được đọc dưới dạng byte thô để kiểm tra chữ ký, nên route này phải đứng trước `express.json()` | `src/app.ts`, [request-lifecycle.md](../02-architecture/request-lifecycle.md) |
| Refresh token family | Các refresh token xoay vòng từ cùng một lần đăng nhập, nhóm bằng `familyId`; dùng lại token đã thu hồi thì thu hồi cả họ | `src/modules/auth/token.service.ts`, `RefreshToken` trong schema |
| Price alert | Theo dõi giá sản phẩm trong wishlist và thông báo khi giá giảm | `src/modules/price-alerts/`, `src/workers/price-alert-worker.ts` |
| Warranty snapshot | Thông tin bảo hành chụp lại tại thời điểm mua, dùng để kiểm tra điều kiện bảo hành sau này | `src/modules/orders/order-warranty.ts`, `src/modules/after-sales/after-sales.eligibility.ts` |
| Mapper / DTO | Hàm chuyển dữ liệu Prisma thành đối tượng trả về client; không bao giờ trả trực tiếp row Prisma hay `password` | `src/modules/*/*.mapper.ts` |

## Nguồn

- [src/lib/idempotency.ts](../../src/lib/idempotency.ts)
- [prisma/schema.prisma](../../prisma/schema.prisma): `OutboxEvent`, `StockMovement`, `CatalogPriceWindow`, `FlashSaleProductQuota`, `PaymentReviewCase`
- [src/modules/outbox/](../../src/modules/outbox/)
- [src/modules/workers/worker-heartbeat.service.ts](../../src/modules/workers/worker-heartbeat.service.ts)
- [src/modules/auth/token.service.ts](../../src/modules/auth/token.service.ts)
- [src/modules/payments/reconciliation.service.ts](../../src/modules/payments/reconciliation.service.ts)
