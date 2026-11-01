# ADR-0002: Prisma ORM với MySQL

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

- Trạng thái: Accepted
- Nguồn gốc: Tái dựng

## Bối cảnh

Dữ liệu của cửa hàng mang tính quan hệ: người dùng, sản phẩm, giỏ hàng, đơn hàng, thanh toán, khuyến mãi, sổ kho. Nhiều thao tác phải nhất quán trong một transaction, ví dụ tạo đơn đồng thời với trừ kho và ghi sổ kho.

Prisma với `provider = "mysql"` xuất hiện lần đầu ở commit `d864088` (2025-06-29), cùng migration `init` đầu tiên. Commit này chỉ có tiêu đề "video 60" nên không ghi lý do. Tại thời điểm baseline có 48 thư mục migration trong `prisma/migrations/`.

## Quyết định

Dùng MySQL 8.4 làm database và Prisma 6.3.0 làm ORM và công cụ migration. Một `PrismaClient` dùng chung được tạo trong `src/config/client.ts`, tự thêm `socket_timeout=30` vào `DATABASE_URL` nếu chưa có, để truy vấn trên kết nối treo không làm request treo mãi. Truy vấn phức tạp (ví dụ catalog) vẫn có thể dùng SQL thô qua Prisma.

## Phương án đã cân nhắc

> **Suy luận:** repo không ghi lại các phương án đã so sánh. Các lựa chọn thay thế hợp lý là TypeORM hoặc Knex với MySQL, hoặc PostgreSQL với Prisma. Code hiện tại gắn với MySQL ở một số điểm (image `mysql:8.4` trong compose, kiểu `@db.VarChar`, `@db.Char`) nên đổi database là một thay đổi lớn.

## Hệ quả

Được:

- Client có kiểu từ `schema.prisma`; schema là nguồn sự thật cho cấu trúc bảng.
- Lịch sử thay đổi cấu trúc được lưu dưới dạng migration trong `prisma/migrations/`, áp dụng bằng `prisma migrate deploy` khi khởi động container.
- Transaction tương tác (`prisma.$transaction`) cho phép gom nhiều bước nghiệp vụ.
- `withPrismaTransactionRetry` thử lại tối đa 3 lần khi gặp lỗi `P2034` (xung đột ghi hoặc deadlock) với độ trễ ngẫu nhiên nhỏ.

Mất:

- Một số truy vấn không diễn đạt được bằng Prisma Client, phải dùng SQL thô (`$queryRaw`), mất bớt kiểm tra kiểu.
- Test không dùng database thật mà mock Prisma, nên các hành vi phụ thuộc MySQL (khoá, lỗi ràng buộc) cần được chú ý riêng khi review.

## Khi thành phần này lỗi

MySQL là kho dữ liệu duy nhất của nghiệp vụ. Khi nó không khả dụng, `/readyz` trả 503, request cần database lỗi 5xx và mọi worker không xử lý được job. `/healthz` vẫn trả 200 vì chỉ báo tiến trình còn sống.

## Nguồn

- [prisma/schema.prisma](../../../prisma/schema.prisma)
- [prisma/migrations/](../../../prisma/migrations/)
- [src/config/client.ts](../../../src/config/client.ts): `prisma`, `withSocketTimeout`
- [src/lib/prisma-retry.ts](../../../src/lib/prisma-retry.ts): `withPrismaTransactionRetry`
- [src/modules/orders/orders.service.ts](../../../src/modules/orders/orders.service.ts)
- [src/routes/health.ts](../../../src/routes/health.ts): `registerHealthRoutes`
- [docker-compose.yml](../../../docker-compose.yml)
- [package.json](../../../package.json): `prisma`, `@prisma/client`
