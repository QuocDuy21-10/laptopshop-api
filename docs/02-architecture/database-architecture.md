# Kiến trúc database

Tài liệu này trả lời: MySQL nằm ở đâu trong kiến trúc, ứng dụng kết nối và migrate ra sao, dữ liệu nào nằm ở MySQL và dữ liệu nào nằm ở nơi khác.

> Đối chiếu code: main @ 0f1eab2 (2026-11-04)

Cấu trúc bảng, cột và ràng buộc nằm ở [03-database/](../03-database/README.md); lý do chọn công nghệ ở [ADR-0002](decisions/0002-prisma-mysql.md). Tài liệu này chỉ nói về vị trí của database trong hệ thống.

## Dữ liệu nằm ở đâu

| Nơi lưu | Dữ liệu | Là nguồn sự thật? |
| --- | --- | --- |
| MySQL 8.4 | Toàn bộ dữ liệu nghiệp vụ: 52 bảng trong [03-database/](../03-database/README.md) | Có |
| Object storage tương thích S3 | File ảnh đánh giá và ảnh đính kèm bảo hành. Metadata (khoá file, kích thước, trạng thái) nằm ở MySQL (`ReviewImage`, `ServiceRequestAttachment`) | File: có. Metadata: ở MySQL |
| Thư mục `public/images` | Ảnh sản phẩm, avatar và ảnh banner trang chủ, do `multer` ghi và `express.static` phục vụ; đường dẫn lưu ở MySQL (`Product.image`, `User.avatar`, `HomeBanner.imagePath`). Trong `docker-compose.yml` là volume `uploads` gắn vào service `app` | File: có. Đường dẫn: ở MySQL |
| Redis | Bộ đếm rate limit, hạn mức AI Advisor, các queue BullMQ, khoá vòng quét price-alert | Không. Sự kiện cần giữ vẫn nằm trong bảng `OutboxEvent` của MySQL cho tới khi được phát |

Redis không phải kho dữ liệu nghiệp vụ: mất Redis làm chậm hoặc dừng việc nền, nhưng dữ liệu đơn hàng, kho và thanh toán vẫn ở MySQL. Xem [integration-architecture.md](integration-architecture.md).

## Kết nối

- Cấu hình bằng biến `DATABASE_URL` (đọc qua `src/config/env.ts`).
- Ứng dụng dùng **một** `PrismaClient` dùng chung trong `src/config/client.ts`. Ngoài production, client được giữ trong `globalThis` để tránh tạo nhiều kết nối khi nạp lại module lúc phát triển.
- `withSocketTimeout` thêm `socket_timeout=30` (giây) vào URL nếu URL chưa có, để truy vấn trên kết nối bị treo không làm request treo vô hạn. Giá trị đặt sẵn trong `DATABASE_URL` được ưu tiên.
- Log truy vấn: ở môi trường `development` ghi `query`, `info`, `warn`, `error`; môi trường khác chỉ ghi `error`.
- Mỗi tiến trình (API và từng worker) tự tạo kết nối của mình; không có pool dùng chung giữa các tiến trình.
- `/readyz` chạy `SELECT 1` qua Prisma; thất bại thì trả 503. `/healthz` không chạm database.

## Migration và seed khi triển khai

`docker/entrypoint.sh` chạy `pnpm exec prisma migrate deploy` rồi `node dist/seed.js` trước khi khởi động tiến trình, khi biến `RUN_MIGRATIONS` khác `false`. Trong `docker-compose.yml`, service API dùng mặc định (chạy migration), còn các worker đặt `RUN_MIGRATIONS: "false"` nên không migrate; vì vậy chỉ một tiến trình thay đổi schema.

- `migrate deploy` chỉ áp dụng các migration đã có; không tạo mới và không reset dữ liệu.
- Seed chỉ chèn vào bảng trống (kiểm tra số dòng của `User`, `Role`, `Product`), nên chạy lại không ghi đè.
- Quy ước và danh sách migration: [migrations.md](../03-database/migrations.md).

## Thời gian và tiền tệ

- Thời điểm lưu ở dạng `DATETIME(3)` (độ chính xác mili giây) theo UTC. "Ngày của cửa hàng" tính theo múi giờ UTC+7, không có giờ mùa hè (`src/lib/shop-time.ts`: `dayStart`, `dayEnd`, `toShopDay`). Biến `STORE_TIME_ZONE` dùng khi định dạng thời gian trong email.
- Số tiền lưu ở dạng số nguyên (`INT`) với tiền tệ `VND` (các bảng `Payment`, `PaymentWebhookEvent`, `ServiceQuote` còn có cột `currency` mặc định `VND`).

## Kiểm thử

Unit test không dùng database thật: Prisma được mock (`tests/helpers/prisma.ts`). Các hành vi phụ thuộc MySQL (khoá hàng, lỗi ràng buộc, `onDelete`) vì vậy không được kiểm tra tự động; xem các cơ chế đó ở [transactions-and-locking.md](../03-database/transactions-and-locking.md).

## Nguồn

- [src/config/client.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/config/client.ts): `prisma`, `withSocketTimeout`
- [src/config/env.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/config/env.ts): `DATABASE_URL`, `STORE_TIME_ZONE`
- [src/routes/health.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/routes/health.ts): `registerHealthRoutes`
- [src/server.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/server.ts): `readyChecks`
- [docker/entrypoint.sh](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/docker/entrypoint.sh)
- [docker-compose.yml](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/docker-compose.yml)
- [src/seed.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/seed.ts)
- [src/lib/shop-time.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/lib/shop-time.ts)
- [src/middlewares/multer.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/middlewares/multer.ts)
- [tests/helpers/prisma.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/tests/helpers/prisma.ts)
