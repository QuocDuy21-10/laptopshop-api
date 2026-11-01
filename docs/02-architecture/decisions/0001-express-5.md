# ADR-0001: Express 5 cho API

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

- Trạng thái: Accepted
- Nguồn gốc: Tái dựng

## Bối cảnh

API là backend JSON REST cho storefront và trang quản trị. Nó cần kiểm soát chặt thứ tự middleware, ví dụ webhook thanh toán phải đọc body thô trước khi parse JSON ([request-lifecycle.md](../request-lifecycle.md)), và cần khởi tạo app trong test mà không dính database hay Redis.

Express 5.0.1 đã có trong `package.json` từ commit `7feaf7b` (2025-05-08), tức từ rất sớm trong lịch sử repo. Commit này chỉ có tiêu đề "video 23" nên không ghi lý do chọn.

## Quyết định

Dùng Express 5 làm web framework và tự tổ chức cấu trúc theo module `routes → controller → service`. `createApp(deps)` trong `src/app.ts` không có side effect: mọi phụ thuộc có thể thay thế (kho lưu rate limit, storage ảnh, health check) được truyền qua tham số, và `src/server.ts` là nơi duy nhất lắp phụ thuộc thật.

## Phương án đã cân nhắc

> **Suy luận:** repo không ghi lại các phương án đã so sánh. Các lựa chọn thay thế hợp lý là NestJS (có sẵn DI và cấu trúc module) và Fastify (hiệu năng cao hơn). Code hiện tại cho thấy dự án chọn framework mỏng và tự định nghĩa quy ước (path alias, `validate`, `AppError`, mapper) thay vì dùng framework có quy ước sẵn.

## Hệ quả

Được:

- Toàn quyền về thứ tự middleware, cần thiết cho webhook và các limiter riêng từng route.
- `createApp` dễ test bằng Supertest; Prisma được mock, không cần hạ tầng thật.
- Express 5 xử lý lỗi trong handler `async` mà không cần bọc thủ công; `errorHandler` nhận được các lỗi này.

Mất:

- Không có DI container; phụ thuộc được truyền thủ công (`AppDeps`) hoặc import trực tiếp.
- Cấu trúc module là quy ước của dự án, không được framework ép buộc, nên cần giữ kỷ luật khi thêm module.
- Express 5 làm `req.query` chỉ đọc, nên `validate` lưu kết quả parse vào `res.locals`.

## Khi thành phần này lỗi

Express là một phần của tiến trình API, không phải thành phần runtime riêng. Lỗi trong handler đi tới `errorHandler` và trả JSON `{ error }`; các worker nền là tiến trình riêng nên không bị ảnh hưởng khi API khởi động lại.

## Nguồn

- [src/app.ts](../../../src/app.ts): `createApp`, `AppDeps`
- [src/server.ts](../../../src/server.ts)
- [src/middlewares/validate.ts](../../../src/middlewares/validate.ts): `validate`
- [src/middlewares/error.middleware.ts](../../../src/middlewares/error.middleware.ts): `errorHandler`
- [package.json](../../../package.json): `express`
