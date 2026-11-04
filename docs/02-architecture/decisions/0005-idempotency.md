# ADR-0005: Idempotency cho thao tác ghi quan trọng

> Đối chiếu code: main @ d3d4cb7 (2026-11-04)

- Trạng thái: Accepted
- Nguồn gốc: Tái dựng

## Bối cảnh

Client và nhà cung cấp ngoài gửi lại yêu cầu là chuyện bình thường: mạng chập chờn, người dùng bấm hai lần, webhook được phát lại, hai tab cùng gửi. Với đặt hàng, điều chỉnh kho, tạo yêu cầu bảo hành hay ghi nhận tiền, làm hai lần nghĩa là trừ kho hai lần, tạo hai đơn hoặc cộng tiền hai lần.

Lịch sử commit cho biết mẫu này xuất hiện dần: `f081231` (2026-10-18) "v1 idempotent checkout" thêm khoá cho đơn hàng; sau đó các commit thêm khoá cho điều chỉnh kho (`1c8f8e3` "make stock adjustments idempotent"), yêu cầu hậu mãi (`4d8a892`), đồng bộ ảnh đánh giá (`7af3f84`) và sự kiện thanh toán. Commit `1dad985` (2026-10-22) nêu mục đích "validate quote fingerprints and payload-aware idempotency": khoá chỉ có nghĩa khi gắn với nội dung yêu cầu. Các commit còn lại không nêu lý do chọn từng biến thể; phần dưới được suy ra từ code.

## Quyết định

Có một mẫu chung và sáu biến thể.

**Mẫu chung:** client gửi một khoá (header `Idempotency-Key`, hoặc `Upload-Key` cho ảnh); server lưu khoá cùng một dấu vân tay của nội dung trong cùng transaction với kết quả; cột khoá có ràng buộc unique theo phạm vi người dùng. Gửi lại cùng khoá và cùng nội dung thì trả kết quả cũ (HTTP 200, `created: false`); cùng khoá khác nội dung thì trả `409 IDEMPOTENCY_KEY_REUSED` (hoặc mã riêng của biến thể); hai yêu cầu chạy đua cùng khoá thì yêu cầu thua bắt lỗi, đọc lại dòng của yêu cầu thắng rồi trả bản phát lại hoặc báo xung đột.

Hàm dùng chung (`src/lib/idempotency.ts`): `idempotencyKeyHeader` là schema Zod cho khoá (chuỗi cắt khoảng trắng, 1 đến 64 ký tự); `sha256Canonical` băm SHA-256 của `JSON.stringify` một mảng các trường, nên thứ tự trường quyết định dấu vân tay.

| Nơi dùng | Khoá | Ràng buộc unique | Dấu vân tay nội dung | Gửi lại cùng nội dung | Khác nội dung | Quy tắc |
| --- | --- | --- | --- | --- | --- | --- |
| Đặt hàng | `Order.idempotencyKey` | `(userId, idempotencyKey)` | `Order.requestHash` từ `createCheckoutRequestHash` (người nhận, địa chỉ, SĐT, phương thức, mã giảm giá, `pricingFingerprint`) | Trả đơn cũ, 200 | `IDEMPOTENCY_KEY_REUSED`; đơn cũ không có `requestHash` thì cho phát lại | CHK-07, CHK-08 trong [checkout-and-payment.md](../../04-business/checkout-and-payment.md) |
| Điều chỉnh kho | `StockMovement.idempotencyKey` | `(actorId, idempotencyKey)` | `requestHash` = `sha256Canonical([productId, delta, reason, note])` | Trả điều chỉnh cũ, 200 | `IDEMPOTENCY_KEY_REUSED` | INV-08, INV-09 trong [inventory.md](../../04-business/inventory.md) |
| Tạo yêu cầu hậu mãi | `ServiceRequest.idempotencyKey` | `(userId, idempotencyKey)` | `requestHash` = SHA-256 của `JSON.stringify` toàn bộ body (không qua `sha256Canonical`) | Trả yêu cầu cũ, 200 | `IDEMPOTENCY_KEY_REUSED` | ASV-05 trong [after-sales.md](../../04-business/after-sales.md) |
| Tải ảnh hậu mãi | `ServiceRequestAttachment.uploadKey` (header `Upload-Key`, hoặc `Idempotency-Key`) | `(serviceRequestItemId, uploadKey, uploadPosition)` | `uploadHash` = SHA-256 của loại, kích thước, kích thước ảnh và nội dung từng ảnh đã xử lý | Trả lại bộ ảnh đã tải | `ATTACHMENT_IDEMPOTENCY_CONFLICT` | ASV-22, ASV-23 |
| Đồng bộ ảnh đánh giá | `ReviewImageSyncOperation.idempotencyKey` | `(userId, reviewId, idempotencyKey)` | `requestFingerprint` từ `createReviewImageSyncFingerprint` (review, phiên bản mong đợi, bản kê, băm từng file) | Trả kết quả đã lưu (`SUCCEEDED`), hoặc phát lại lỗi (`FAILED`); đang xử lý và còn lease thì báo đang chạy | `IDEMPOTENCY_KEY_REUSED` | chưa có tài liệu nghiệp vụ |
| Giao dịch thanh toán | `providerEventId` và `providerTransactionKey` do nhà cung cấp cấp | `(provider, providerMode, providerEventId)` và `(provider, providerMode, providerTransactionKey)` | Không có dấu vân tay; so các trường chuẩn hoá (số tiền, loại tiền, chiều, mã chuyển khoản) | Trả trạng thái đã lưu, `duplicate: true` | Chỉ ghi cảnh báo log, vẫn trả bản đã lưu | PAY-07 trong [checkout-and-payment.md](../../04-business/checkout-and-payment.md) |

Những chỗ khác mẫu (đọc từ code):

- **Thanh toán** không có khoá do client gửi và không có dấu vân tay nội dung: khoá đến từ nhà cung cấp, có hai khoá cùng trỏ một giao dịch, và hai khoá trỏ hai dòng khác nhau là lỗi `PAYMENT_EVENT_IDENTITY_CONFLICT`. Lý do không băm payload: cùng một giao dịch có hai nguồn (webhook và đối soát) với payload khác nhau.
- **Đồng bộ ảnh đánh giá** là biến thể duy nhất có trạng thái và lease (`PROCESSING`, `SUCCEEDED`, `FAILED`) vì thao tác kéo dài và gồm nhiều bước; các biến thể khác hoàn tất trong một transaction. Thao tác có hạn lưu (`expiresAt`).
- **Tải ảnh hậu mãi** chốt theo từng vị trí ảnh (`uploadPosition`) và dùng dấu vân tay của ảnh đã xử lý, không phải của file gốc.
- **Hậu mãi** băm bằng `JSON.stringify` trực tiếp, nên dấu vân tay phụ thuộc thứ tự khoá của body; các nơi khác băm một mảng có thứ tự cố định bằng `sha256Canonical`.
- **Đặt hàng** chấp nhận phát lại khi đơn cũ không có `requestHash` (đơn tạo trước khi thêm cột).

## Phương án đã cân nhắc

> **Suy luận:** repo không ghi lại các phương án đã so sánh. Hai phương án hợp lý: (1) chỉ dùng khoá, không băm nội dung, đơn giản nhưng cùng khoá khác nội dung sẽ âm thầm trả kết quả sai; (2) khoá idempotency lưu ở Redis với TTL, nhanh nhưng mất khi Redis mất và không nằm trong transaction với kết quả. Thiết kế hiện tại lưu khoá cạnh dữ liệu trong MySQL để unique và kết quả cùng nguyên tử.

## Hệ quả (được / mất)

Được:

- Gửi lại an toàn ở mọi thao tác ghi quan trọng; kết quả cũ trả về nguyên vẹn.
- Phát hiện client dùng nhầm khoá cho nội dung khác thay vì trả kết quả sai.
- Không cần thành phần ngoài (không phụ thuộc Redis).

Mất:

- Mỗi biến thể tự hiện thực, dễ lệch nhau (hàm băm, mã lỗi, quy tắc đua khác nhau) vì không có lớp dùng chung ngoài hai hàm nhỏ.
- Cột khoá nằm trên bảng nghiệp vụ nên khoá tồn tại bao lâu bằng dữ liệu (trừ đồng bộ ảnh đánh giá có hạn lưu); không có cơ chế hết hạn chung.
- Phạm vi unique khác nhau (theo `userId`, `actorId`, theo thiết bị), nên cùng một chuỗi khoá ở hai nơi là hai khoá khác nhau.

## Khi thành phần này lỗi

- Mất mạng giữa chừng: client gửi lại cùng khoá để lấy kết quả; riêng đặt hàng có `GET /orders/checkout-attempt` tra theo khoá (xem CHK-20).
- Client đổi nội dung mà giữ khoá: nhận `409`; phải tạo khoá mới.
- Ghi đồng thời cùng khoá: bên thua phát hiện qua lỗi unique rồi đọc bản của bên thắng; nếu cả hai thất bại vì lý do khác thì lỗi gốc được trả về.
- Dòng cũ không có dấu vân tay (đơn trước khi có `requestHash`): được phát lại mà không so nội dung.

## Nguồn

- [src/lib/idempotency.ts](../../../src/lib/idempotency.ts): `idempotencyKeyHeader`, `sha256Canonical`
- [src/modules/orders/orders.service.ts](../../../src/modules/orders/orders.service.ts): `placeOrder`
- [src/modules/promotions/promotion-fingerprint.ts](../../../src/modules/promotions/promotion-fingerprint.ts): `createCheckoutRequestHash`
- [src/modules/inventory/inventory.service.ts](../../../src/modules/inventory/inventory.service.ts): `adjustStock`
- [src/modules/after-sales/after-sales.service.ts](../../../src/modules/after-sales/after-sales.service.ts): `createServiceRequest`
- [src/modules/after-sales/after-sales.attachments.ts](../../../src/modules/after-sales/after-sales.attachments.ts): `addServiceAttachments`
- [src/modules/reviews/review-image-sync.fingerprint.ts](../../../src/modules/reviews/review-image-sync.fingerprint.ts): `createReviewImageSyncFingerprint`
- [src/modules/reviews/review-image-sync.service.ts](../../../src/modules/reviews/review-image-sync.service.ts): `reserveOperation`
- [src/modules/payments/payment-ingestion.service.ts](../../../src/modules/payments/payment-ingestion.service.ts): `ingestPaymentTransaction`
- [prisma/schema.prisma](../../../prisma/schema.prisma): các ràng buộc unique nêu trong bảng
