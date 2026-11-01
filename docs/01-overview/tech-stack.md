# Công nghệ sử dụng

Tài liệu này trả lời: dự án dùng công nghệ gì, phiên bản bao nhiêu và mỗi thứ đóng vai trò gì.

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

Phiên bản lấy từ `package.json`, `docker-compose.yml` và `Dockerfile`.

| Lớp | Công nghệ | Phiên bản | Dùng để | ADR |
| --- | --- | --- | --- | --- |
| Runtime | Node.js | 22 (image `node:22-alpine`) | Chạy API và worker | |
| Ngôn ngữ | TypeScript | 5.7.3 | Toàn bộ mã nguồn | |
| Web framework | Express | 5.0.1 | HTTP API, middleware | [ADR-0001](../02-architecture/decisions/0001-express-5.md) |
| ORM | Prisma (`prisma`, `@prisma/client`) | 6.3.0 | Truy cập database, migration | [ADR-0002](../02-architecture/decisions/0002-prisma-mysql.md) |
| Database | MySQL | 8.4 (image `mysql:8.4`) | Lưu dữ liệu nghiệp vụ | [ADR-0002](../02-architecture/decisions/0002-prisma-mysql.md) |
| Cache, queue | Redis | 7 (image `redis:7-alpine`) | Lưu trạng thái rate limit và là backend của BullMQ | [ADR-0003](../02-architecture/decisions/0003-redis-bullmq.md) |
| Hàng đợi | BullMQ | ^6.4.0 | Job nền có retry (thông báo, cảnh báo giá, bảo hành) | [ADR-0003](../02-architecture/decisions/0003-redis-bullmq.md) |
| Redis client | `redis` | 5.12.1 | Kết nối Redis, store cho rate limit | [ADR-0003](../02-architecture/decisions/0003-redis-bullmq.md) |
| Rate limit | `express-rate-limit`, `rate-limit-redis` | 8.7.1, 6.0.1 | Giới hạn tần suất request | |
| Validation | Zod | 3.24.2 | Validate input và sinh OpenAPI | |
| API docs | `@asteasolutions/zod-to-openapi`, `swagger-ui-express` | 7.3.4, 5.0.1 | Tài liệu OpenAPI tại `/api-docs` | |
| Bảo mật HTTP | `helmet` | 8.3.0 | Header bảo mật | |
| Log | `pino` | 10.4.0 | Log có cấu trúc | |
| Giám sát lỗi | `@sentry/node` | 11.8.0 | Báo lỗi, no-op khi không có `SENTRY_DSN` | |
| Upload, ảnh | `multer`, `sharp` | 1.4.5-lts.1, 0.35.5 | Nhận và xử lý ảnh upload | |
| Object storage | `@aws-sdk/client-s3` | 3.1154.0 | Lưu ảnh review và ảnh bảo hành (S3-compatible) | |
| Email | `nodemailer` | ^10.2.1 | Gửi email qua SMTP | |
| Web Push | `web-push` | ^3.6.7 | Gửi thông báo đẩy | |
| Test | Jest, Supertest | 30.5.2, 7.3.1 | Unit test (Prisma được mock, không dùng DB hay Redis thật) | |
| Chất lượng code | ESLint, Prettier, husky | 10.13.0, 3.9.10, 9.1.7 | Lint, format, hook commit | |

Hạ tầng phụ cho môi trường local trong `docker-compose.yml`: Mailpit (`axllent/mailpit`) làm SMTP giả và RustFS (`rustfs/rustfs`) làm object storage tương thích S3.

Redis được dùng cho cả hai việc: lưu trạng thái rate limit trong tiến trình API và làm backend cho các queue BullMQ. Xem [integration-architecture.md](../02-architecture/integration-architecture.md).

## Nguồn

- [package.json](../../package.json)
- [docker-compose.yml](../../docker-compose.yml)
- [Dockerfile](../../Dockerfile)
- [src/config/env.ts](../../src/config/env.ts): `env`
