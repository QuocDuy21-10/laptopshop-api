# Kiến trúc tích hợp ngoài

Tài liệu này trả lời: mỗi dịch vụ bên ngoài được cấu hình bằng biến môi trường nào, bật/tắt ra sao và khi nó lỗi hoặc bị tắt thì chức năng nào bị ảnh hưởng.

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

Chỉ tên biến môi trường được ghi ở đây, không có giá trị. Mọi biến được khai báo và kiểm tra bằng Zod trong `src/config/env.ts`; cấu hình sai khiến tiến trình dừng ngay khi khởi động. Mẫu giá trị an toàn nằm ở `.env.example`.

## Tổng hợp

| Tích hợp | Công tắc | Tắt hoặc lỗi thì |
| --- | --- | --- |
| MySQL | Bắt buộc (`DATABASE_URL`) | API và mọi worker không hoạt động; `/readyz` trả 503 |
| Redis | Bắt buộc (`REDIS_URL`) | Rate limit, hạn mức AI Advisor, queue và khoá của price-alert không hoạt động; `/readyz` trả 503 |
| SePay | `BANK_TRANSFER_ENABLED`, `PAYMENT_PROVIDER` | Tắt thì đặt hàng bằng chuyển khoản bị từ chối |
| Groq | `ADVISOR_AI_ENABLED` | Tắt hoặc lỗi thì AI Advisor trả gợi ý theo luật (fallback) |
| Object storage | `REVIEW_IMAGES_ENABLED`, `AFTER_SALES_IMAGES_ENABLED` | Tắt thì chức năng ảnh tương ứng không khả dụng |
| Email (SMTP) | `EMAIL_ENABLED` | Tắt thì không gửi email |
| Web Push | `WEB_PUSH_ENABLED` | Tắt thì không gửi thông báo đẩy |
| Sentry | `SENTRY_DSN` | Không đặt thì không báo lỗi lên Sentry |

## MySQL

- **Mục đích:** lưu toàn bộ dữ liệu nghiệp vụ qua Prisma ([ADR-0002](decisions/0002-prisma-mysql.md)).
- **Biến:** `DATABASE_URL`.
- **Khi lỗi:** `/readyz` chạy `SELECT 1` và trả 503 nếu thất bại. Các request cần database trả lỗi 5xx; worker không xử lý được job.

## Redis

- **Mục đích:** lưu trạng thái rate limit (tiền tố `rl:*`) và hạn mức/điều phối của AI Advisor trong API; làm backend BullMQ cho dispatcher và worker; giữ khoá phân tán của vòng quét price-alert ([ADR-0003](decisions/0003-redis-bullmq.md)).
- **Biến:** `REDIS_URL`, `NOTIFICATION_QUEUE_PREFIX`, `AFTER_SALES_QUEUE_PREFIX`.
- **Khi lỗi:** `/readyz` chạy `ping` và trả 503 nếu thất bại. Dòng outbox vẫn nằm trong MySQL; dispatcher không đẩy được job cho tới khi Redis hoạt động lại.

> **Suy luận:** vì sự kiện được lưu bền trong MySQL trước khi vào queue, việc Redis gián đoạn làm chậm việc nền thay vì làm mất sự kiện.

## SePay (thanh toán chuyển khoản QR)

- **Mục đích:** nhận webhook giao dịch và gọi API của SePay để đối soát. Provider được chọn trong `payment-provider.factory.ts`.
- **Biến:** `BANK_TRANSFER_ENABLED`, `PAYMENT_PROVIDER` (`fake` hoặc `sepay`), `SEPAY_MODE` (`test` hoặc `live`, quyết định URL sandbox hay thật), `SEPAY_WEBHOOK_SECRET`, `SEPAY_API_TOKEN`, `SEPAY_BANK_CODE`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME`, `SEPAY_API_TIMEOUT_MS`, `PAYMENT_EVENT_ENCRYPTION_KEY`, `PAYMENT_EVENT_KEY_ID`, `PAYMENT_TTL_MINUTES`, `PAYMENT_GRACE_SECONDS`, `PAYMENT_RECONCILIATION_INTERVAL_MS`, `PAYMENT_RECONCILIATION_SETTLEMENT_SECONDS`, `PAYMENT_MAX_AUTO_HOLD_MINUTES`, `PAYMENT_RECONCILIATION_LEASE_MS`.
- **Ràng buộc khi khởi động:** nếu `BANK_TRANSFER_ENABLED` hoặc `PAYMENT_PROVIDER=sepay` thì các khoá mã hoá và thông tin SePay phải có đủ. Ở production với `BANK_TRANSFER_ENABLED`, bắt buộc `PAYMENT_PROVIDER=sepay` và `SEPAY_MODE=live`. `PAYMENT_RECONCILIATION_LEASE_MS` phải lớn hơn `SEPAY_API_TIMEOUT_MS`.
- **Khi tắt:** tạo đơn với phương thức `BANK_TRANSFER` trả `409 PAYMENT_METHOD_UNAVAILABLE`. Provider `fake` bị từ chối ở webhook khi chạy production.
- **Khi SePay lỗi:** việc đối soát của `payment-worker` bị lỗi theo chu kỳ và chạy lại ở lượt sau; webhook không đến thì giao dịch chỉ được phát hiện qua đối soát.

## Groq (AI Advisor)

- **Mục đích:** tạo phần giải thích cho gợi ý laptop. Danh sách ứng viên và xếp hạng do chính hệ thống tính trước.
- **Biến:** `ADVISOR_AI_ENABLED`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_STRUCTURED_OUTPUT_MODE`, `ADVISOR_AI_TIMEOUT_MS`, `ADVISOR_AI_MAX_OUTPUT_TOKENS`, `ADVISOR_GUEST_DAILY_LIMIT`, `ADVISOR_USER_DAILY_LIMIT`, `ADVISOR_GLOBAL_DAILY_LIMIT`, `ADVISOR_CANDIDATE_BATCH_SIZE`, `ADVISOR_AI_CONCURRENCY_LIMIT`, `ADVISOR_AI_CONCURRENCY_LEASE_MS`.
- **Khi tắt hoặc lỗi:** khi `ADVISOR_AI_ENABLED` tắt, service được tạo không có provider. Khi provider có nhưng lỗi, không qua được kiểm tra hạn mức, hoặc kết quả không khớp thứ tự xếp hạng, service dùng `buildRuleBasedRecommendation` để trả gợi ý theo luật và chỉ ghi log phân loại lỗi.

## Object storage tương thích S3

- **Mục đích:** lưu ảnh đánh giá và ảnh đính kèm yêu cầu bảo hành, truy cập qua URL có hạn. Local dùng RustFS, production dùng dịch vụ tương thích S3.
- **Biến (ảnh đánh giá):** `REVIEW_IMAGES_ENABLED`, `REVIEW_IMAGE_S3_ENDPOINT`, `REVIEW_IMAGE_S3_REGION`, `REVIEW_IMAGE_S3_BUCKET`, `REVIEW_IMAGE_S3_ACCESS_KEY_ID`, `REVIEW_IMAGE_S3_SECRET_ACCESS_KEY`, `REVIEW_IMAGE_S3_FORCE_PATH_STYLE`, `REVIEW_IMAGE_URL_TTL_SECONDS`.
- **Biến (ảnh bảo hành):** `AFTER_SALES_IMAGES_ENABLED`, `AFTER_SALES_IMAGE_S3_ENDPOINT`, `AFTER_SALES_IMAGE_S3_REGION`, `AFTER_SALES_IMAGE_S3_BUCKET`, `AFTER_SALES_IMAGE_S3_ACCESS_KEY_ID`, `AFTER_SALES_IMAGE_S3_SECRET_ACCESS_KEY`, `AFTER_SALES_IMAGE_S3_FORCE_PATH_STYLE`, `AFTER_SALES_IMAGE_URL_TTL_SECONDS`.
- **Khi tắt:** `createS3ObjectStorage` trả `null`. Với ảnh đánh giá, các thao tác ảnh trả `REVIEW_IMAGE_STORAGE_UNAVAILABLE`. Phần còn lại của đánh giá và bảo hành vẫn dùng được.
- Ảnh sản phẩm và avatar không đi qua storage này: chúng được `multer` ghi vào `public/images` và phục vụ bằng `express.static`.

## Email (SMTP)

- **Mục đích:** gửi email xác minh và thông báo qua `notification-worker`.
- **Biến:** `EMAIL_ENABLED`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_OTP_ENCRYPTION_KEY`, `EMAIL_OTP_KEY_VERSION`.
- **Ràng buộc khi khởi động:** `SMTP_USER` và `SMTP_PASSWORD` phải cấu hình cùng nhau. Khi `EMAIL_ENABLED`, bắt buộc có `EMAIL_OTP_ENCRYPTION_KEY`, và ở production, `EMAIL_PROVIDER=smtp` bị từ chối.
- **Khi tắt:** worker không đăng ký provider email nên không gửi email. Local dùng Mailpit.
- **Khi lỗi:** lần gửi thất bại được ghi nhận và thử lại tới `DELIVERY_MAX_ATTEMPTS` lần.

## Web Push

- **Mục đích:** gửi thông báo đẩy tới trình duyệt đã đăng ký.
- **Biến:** `WEB_PUSH_ENABLED`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- **Ràng buộc khi khởi động:** bật thì cả ba biến VAPID là bắt buộc.
- **Khi lỗi:** nếu dịch vụ báo subscription không còn tồn tại (`PUSH_SUBSCRIPTION_GONE`), subscription bị đánh dấu vô hiệu (`disabledAt`).

## Sentry

- **Mục đích:** báo lỗi 5xx. Cấu hình không gửi cookie, header xác thực, body request hay thông tin người dùng.
- **Biến:** `SENTRY_DSN`, `GIT_SHA` (gắn làm release).
- **Khi tắt:** `src/instrument.ts` không làm gì nếu thiếu `SENTRY_DSN`.

## Nguồn

- [src/config/env.ts](../../src/config/env.ts): `env`
- [.env.example](../../.env.example)
- [src/server.ts](../../src/server.ts): `readyChecks`, `ADVISOR_AI_ENABLED`
- [src/instrument.ts](../../src/instrument.ts)
- [src/modules/payments/payment-provider.factory.ts](../../src/modules/payments/payment-provider.factory.ts): `paymentProvider`
- [src/modules/payments/payments.controller.ts](../../src/modules/payments/payments.controller.ts): `paymentWebhookHandler`
- [src/modules/orders/orders.service.ts](../../src/modules/orders/orders.service.ts)
- [src/modules/advisor/advisor.service.ts](../../src/modules/advisor/advisor.service.ts): `createAdvisorService`
- [src/modules/advisor/advisor.explanation.ts](../../src/modules/advisor/advisor.explanation.ts): `buildRuleBasedRecommendation`
- [src/lib/storage/s3-object-storage.ts](../../src/lib/storage/s3-object-storage.ts): `createS3ObjectStorage`
- [src/modules/reviews/review-images.service.ts](../../src/modules/reviews/review-images.service.ts)
- [src/workers/notification-worker.ts](../../src/workers/notification-worker.ts)
- [src/modules/notifications/notification-delivery.service.ts](../../src/modules/notifications/notification-delivery.service.ts)
