# ADR-0003: Redis và BullMQ cho rate limit và việc nền

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

- Trạng thái: Accepted
- Nguồn gốc: Tái dựng

## Bối cảnh

Hệ thống cần hai thứ mà MySQL không phù hợp làm: bộ đếm tần suất request dùng chung giữa nhiều tiến trình, và hàng đợi job nền có retry (gửi thông báo, đánh giá lại giá, xử lý mốc bảo hành).

Lịch sử commit cho biết hai thời điểm:

- Commit `54f7ec5` (2026-10-18), "feat: redis client and rate limiters", thêm `redis`, `rate-limit-redis`, `src/config/redis.ts` và `src/middlewares/rate-limit.ts`. Redis vào dự án với mục đích rate limit.
- Commit `9418432` (2026-10-23), "feat(notification): add transactional outbox delivery pipeline", thêm `bullmq`. Message nêu rõ mục đích: đẩy job BullMQ có định danh xác định từ các dòng outbox được thuê (lease), cùng chính sách retry.

## Quyết định

Dùng một Redis 7 cho cả hai việc. Trong `docker-compose.yml`, Redis chạy với `--appendonly yes` (ghi AOF) và `--maxmemory-policy noeviction` (không tự xoá key khi đầy bộ nhớ). Có ba queue BullMQ: `notification-delivery-v1`, `pricing-evaluation-v1`, `after-sales-milestone-v1`. Job không được API đẩy trực tiếp mà đi qua outbox ([background-jobs.md](../background-jobs.md)).

Việc dùng chung này khiến Redis còn có vai trò thứ ba trong code: khoá phân tán cho vòng quét price-alert và hạn mức của AI Advisor.

## Phương án đã cân nhắc

> **Suy luận:** repo không ghi lại các phương án đã so sánh. Các lựa chọn thay thế hợp lý là dùng bảng job trong MySQL tự poll, hoặc một message broker như RabbitMQ. Việc đã có Redis cho rate limit trước khi cần hàng đợi khiến BullMQ là bước thêm nhỏ về hạ tầng; `noeviction` và AOF cho thấy dữ liệu queue được coi trọng độ bền.

## Hệ quả

Được:

- Rate limit chia sẻ giữa nhiều tiến trình API qua `RedisStore`, mỗi loại limiter có tiền tố riêng (`rl:*`).
- Retry có sẵn: `defaultJobOptions` đặt `attempts: 5` với backoff luỹ thừa từ 1 giây.
- Outbox giữ sự kiện bền trong MySQL, nên Redis chỉ là đường vận chuyển.

Mất:

- Thêm một thành phần hạ tầng cần vận hành và giám sát.
- `noeviction` nghĩa là Redis đầy bộ nhớ sẽ từ chối ghi thay vì xoá dữ liệu, nên cần theo dõi dung lượng.
- Hai mục đích khác nhau (rate limit và queue) dùng chung một Redis, nên sự cố ở một bên ảnh hưởng bên kia.

## Khi thành phần này lỗi

- `/readyz` gọi `redis.ping()` và trả 503 nếu thất bại.
- Rate limit và hạn mức AI Advisor ở API phụ thuộc Redis.
- Dispatcher không đẩy được job cho tới khi Redis trở lại. Dòng outbox vẫn nằm trong MySQL, và lỗi được ghi bằng `markOutboxFailed` (tăng `publishAttempts`, nhả lease) để thử lại.
- `notification-worker`, `after-sales-worker` và phần consumer của `price-alert-worker` không nhận được job.
- `payment-worker` không dùng Redis nên vẫn chạy.

## Nguồn

- [src/config/redis.ts](../../../src/config/redis.ts): `createRedisClient`
- [src/middlewares/rate-limit.ts](../../../src/middlewares/rate-limit.ts): `createRedisLimitStore`, `createLimiters`
- [src/queues/queue.factory.ts](../../../src/queues/queue.factory.ts): `createQueue`, `createWorker`, `defaultJobOptions`
- [src/queues/notification.queue.ts](../../../src/queues/notification.queue.ts)
- [src/queues/pricing.queue.ts](../../../src/queues/pricing.queue.ts)
- [src/queues/after-sales.queue.ts](../../../src/queues/after-sales.queue.ts)
- [src/workers/outbox-dispatcher.ts](../../../src/workers/outbox-dispatcher.ts)
- [src/modules/outbox/outbox.repository.ts](../../../src/modules/outbox/outbox.repository.ts): `markOutboxFailed`
- [docker-compose.yml](../../../docker-compose.yml)
- [package.json](../../../package.json): `bullmq`, `redis`, `rate-limit-redis`
