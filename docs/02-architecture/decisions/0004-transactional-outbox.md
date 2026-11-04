# ADR-0004: Transactional Outbox cho việc nền

> Đối chiếu code: main @ d3d4cb7 (2026-11-04)

- Trạng thái: Accepted
- Nguồn gốc: Tái dựng

## Bối cảnh

Một số thay đổi nghiệp vụ cần kéo theo việc chạy nền: gửi thông báo, đánh giá lại giá cho cảnh báo giá, nhắc và tự đóng yêu cầu hậu mãi sau 72, 144, 168 giờ, xoá ảnh hậu mãi khỏi kho lưu trữ. Nếu API vừa ghi MySQL vừa đẩy job vào Redis thì có hai nơi có thể lệch nhau: commit xong mà Redis lỗi thì mất việc; đẩy job trước mà transaction huỷ thì có việc cho một thay đổi không tồn tại.

Lịch sử commit cho biết khi nào: commit `c278d7d` (2026-10-23) thêm model `OutboxEvent` cùng dữ liệu thông báo, và commit `9418432` (2026-10-23) "add transactional outbox delivery pipeline" thêm bộ phát. Các commit nêu tên mẫu thiết kế và cách làm ("dispatch deterministic BullMQ jobs from leased outbox rows") nhưng không nêu lý do chọn; phần lý do ở trên được suy ra từ code.

## Quyết định

Code nghiệp vụ không đẩy job vào BullMQ. Nó ghi một dòng `OutboxEvent` trong cùng transaction với thay đổi dữ liệu. Tiến trình `outbox-dispatcher` đọc bảng này và đẩy job vào hàng đợi (xem [background-jobs.md](../background-jobs.md)).

- **Bốn loại sự kiện** (`OutboxEventType`) và hàng đợi đích: `NOTIFICATION_DELIVERY_REQUESTED` vào hàng đợi thông báo; `PRICE_REEVALUATION_REQUESTED` vào hàng đợi giá (dùng chung `NOTIFICATION_QUEUE_PREFIX`); `AFTER_SALES_MILESTONE_REQUESTED` và `AFTER_SALES_ATTACHMENT_DELETE_REQUESTED` vào hàng đợi hậu mãi.
- **Chống ghi trùng:** `dedupeKey` là cột unique; nơi ghi dùng `upsert` hoặc khoá xác định (ví dụ `delivery-outbox-<id>`, `after-sales-milestone:<itemId>:<version>:<milestone>`), nên ghi lại cùng sự kiện không tạo dòng mới.
- **Thuê lô bằng lease:** `claimOutboxBatch` chọn các dòng chưa phát (`publishedAt` rỗng), đã đến `availableAt` và chưa bị thuê hoặc lease đã hết; rồi thuê từng dòng bằng `UPDATE` có điều kiện, nên nhiều dispatcher chạy song song không lấy trùng một dòng. Kích thước lô là `OUTBOX_BATCH_SIZE`, thời hạn lease là `OUTBOX_LEASE_MS`.
- **Đẩy vào hàng đợi với `jobId` xác định** (ghép từ loại sự kiện, id đối tượng và id sự kiện hoặc mốc), rồi `markOutboxPublished`. Sự kiện có `availableAt` ở tương lai được dùng làm hẹn giờ (mốc nhắc hậu mãi).
- **Thử lại:** lỗi khi đẩy gọi `markOutboxFailed`: tăng `publishAttempts`, ghi `lastErrorCode`, nhả lease; dòng đó lại đủ điều kiện ở lượt kế tiếp (vòng lặp nghỉ 1 giây giữa các lượt). Code không có giới hạn số lần thử hay độ trễ tăng dần.
- **Dọn dẹp:** dòng đã phát quá 30 ngày bị xoá bởi `applyNotificationRetention` (chạy trong `notification-maintenance-worker`).

## Phương án đã cân nhắc

> **Suy luận:** repo không ghi lại các phương án đã so sánh. Hai phương án hợp lý: (1) đẩy job vào BullMQ ngay trong request, ít thành phần hơn nhưng có thể mất hoặc thừa việc khi Redis hoặc transaction lỗi; (2) bảng job tự poll do từng worker đọc trực tiếp, bỏ được BullMQ nhưng phải tự làm retry, lịch hẹn và giới hạn đồng thời. Thiết kế hiện tại giữ BullMQ cho việc thực thi (xem [ADR-0003](0003-redis-bullmq.md)) và dùng bảng outbox chỉ để bảo đảm việc "đã được hứa" không mất.

## Hệ quả (được / mất)

Được:

- Sự kiện và thay đổi dữ liệu cùng thành công hoặc cùng thất bại; API chết ngay sau commit thì dòng outbox vẫn còn trong MySQL.
- Dispatcher có thể chạy nhiều bản; hẹn giờ dài (168 giờ) không cần giữ job trong Redis từ đầu.
- Nơi ghi (thông báo, hậu mãi, đánh giá lại giá) giữ nguyên mẫu `tx.outboxEvent` trong transaction của mình.

Mất:

- Có độ trễ giữa commit và job (tối đa khoảng một chu kỳ vòng lặp 1 giây), và thêm một tiến trình phải vận hành.
- Giao hàng là "ít nhất một lần": consumer phải chịu được job lặp (job dùng `jobId` xác định và khoá `dedupeKey` ở phía nhận thông báo).
- Bảng `outbox_events` lớn dần cho tới khi job dọn dẹp chạy.
- Lỗi vĩnh viễn (ví dụ loại sự kiện không có queue) sẽ bị thử lại mãi mỗi giây vì không có giới hạn số lần thử.

## Khi thành phần này lỗi

- **Dispatcher dừng:** sự kiện vẫn được ghi nhưng không thành job; thông báo không gửi, mốc tự đóng hậu mãi và xoá ảnh không chạy, cảnh báo giá không được đánh giá lại. Khi dispatcher chạy lại nó xử lý các dòng đã đến hạn. Số dòng chưa phát được đếm ở trang quản trị thông báo.
- **Redis mất:** việc đẩy vào hàng đợi lỗi, dòng ở lại với `lastErrorCode` và `publishAttempts` tăng; hết sự cố thì tự phát lại.
- **`NOTIFICATION_OUTBOX_ENABLED` tắt (mặc định `false`):** `outbox-dispatcher` thoát ngay; nơi ghi vẫn tạo dòng outbox nên dữ liệu tích lũy nhưng không có việc nào chạy cho tới khi bật cờ.
- Hậu mãi có thêm cờ riêng `AFTER_SALES_WORKER_ENABLED` cho worker nhận việc; xem [after-sales.md](../../04-business/after-sales.md).

Chi tiết bảng: [messaging-ops.md](../../03-database/contexts/messaging-ops.md).

## Nguồn

- [prisma/schema.prisma](../../../prisma/schema.prisma): `OutboxEvent`
- [src/modules/outbox/outbox.repository.ts](../../../src/modules/outbox/outbox.repository.ts): `createOutboxEvent`, `claimOutboxBatch`, `markOutboxPublished`, `markOutboxFailed`
- [src/modules/outbox/outbox.dispatcher.ts](../../../src/modules/outbox/outbox.dispatcher.ts): `dispatchOutboxBatch`
- [src/modules/outbox/outbox.types.ts](../../../src/modules/outbox/outbox.types.ts): `OutboxEventType`
- [src/workers/outbox-dispatcher.ts](../../../src/workers/outbox-dispatcher.ts): `runOutboxDispatcherOnce`
- [src/modules/notifications/notification-publish.service.ts](../../../src/modules/notifications/notification-publish.service.ts): `publishNotification`
- [src/modules/notifications/notification-retention.service.ts](../../../src/modules/notifications/notification-retention.service.ts): `applyNotificationRetention`
- [src/modules/after-sales/after-sales-maintenance.ts](../../../src/modules/after-sales/after-sales-maintenance.ts): `scheduleConfirmationMilestones`
