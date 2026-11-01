# Chức năng và vai trò

Tài liệu này trả lời: vai trò nào dùng được nhóm chức năng nào của API.

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

## Vai trò

| Vai trò | Cách xác định |
| --- | --- |
| Guest | Không có phiên đăng nhập |
| Customer | Đã đăng nhập, role `USER` |
| Admin | Đã đăng nhập, role `ADMIN` |
| System | Tiến trình bên ngoài hoặc worker; webhook thanh toán xác thực bằng chữ ký, không qua phiên người dùng |

Phiên đăng nhập là cookie HttpOnly `access_token` (hoặc header `Authorization: Bearer`). `authenticate` bắt buộc có phiên, `optionalAuthenticate` cho phép khách vãng lai nhưng nhận diện người dùng nếu có phiên.

## Ma trận truy cập theo nhóm route

Ký hiệu: ✅ được dùng, ➖ không áp dụng. "Ghi" nghĩa là các thao tác tạo, sửa, xoá.

| Nhóm route (`/api/v1/...`) | Guest | Customer | Admin | Ghi chú |
| --- | --- | --- | --- | --- |
| `/auth` (đăng ký, đăng nhập, quên và đặt lại mật khẩu, refresh, đăng xuất) | ✅ | ✅ | ✅ | Có rate limit riêng cho đăng nhập, đăng ký, quên và đặt lại mật khẩu |
| `/store-info`, `/home-banners` (đọc) | ✅ | ✅ | ✅ | Công khai |
| `/newsletter` (đăng ký, xác nhận, huỷ) | ✅ | ✅ | ✅ | Công khai, có rate limit riêng cho đăng ký |
| `/products` (danh sách, bộ lọc, so sánh, chi tiết, đọc đánh giá) | ✅ | ✅ | ✅ | Đọc công khai |
| `/products/:id/reviews`, `/reviews` (ghi, ảnh, hữu ích) | ➖ | ✅ | ✅ | Ghi cần đăng nhập |
| `/promotions` | ✅ | ✅ | ✅ | Đọc công khai; riêng `/promotions/flash-sales/availability` dùng `optionalAuthenticate` để tính theo tài khoản nếu có phiên |
| `/advisor` | ✅ | ✅ | ✅ | `optionalAuthenticate`; có hạn mức riêng cho khách, người dùng và toàn hệ thống |
| `/users/me` | ➖ | ✅ | ✅ | Hồ sơ của chính mình |
| `/cart`, `/orders` | ➖ | ✅ | ✅ | Mọi truy vấn được scope theo người dùng hiện tại |
| `/payments` | ➖ | ✅ | ✅ | Thanh toán của đơn thuộc người dùng |
| `/wishlist` | ➖ | ✅ | ✅ | Gồm cảnh báo giá |
| `/notifications`, `/notification-preferences`, `/web-push` | ➖ | ✅ | ✅ | Thông báo của chính mình |
| `/me/email-verification` | ➖ | ✅ | ✅ | Xác minh email |
| `/after-sales` | ➖ | ✅ | ✅ | Yêu cầu bảo hành của chính mình |
| `/webhooks/payments` | ➖ | ➖ | ➖ | Chỉ System (nhà cung cấp thanh toán), xác thực chữ ký trên raw body |
| `/admin/*` | ➖ | ➖ | ✅ | Một lần `authenticate` + `requireRole("ADMIN")` cho toàn bộ router admin |

## Phạm vi của `/admin`

Router admin gồm: `products`, `users`, `roles`, `orders`, `dashboard`, `inventory`, `payment-events`, `payment-review-cases`, `reviews`, `after-sales`, `promotions`, `newsletter`, `home-banners` và các route thông báo.

API contract chi tiết (endpoint, request, response, lỗi) nằm ở OpenAPI: [src/docs/openapi.ts](../../src/docs/openapi.ts), xem trên `/api-docs` khi `ENABLE_DOCS=true`. Tài liệu này không chép lại.

## Nguồn

- [src/routes/index.ts](../../src/routes/index.ts): `createApiV1Router`
- [src/middlewares/authenticate.ts](../../src/middlewares/authenticate.ts): `authenticate`, `optionalAuthenticate`
- [src/middlewares/require-role.ts](../../src/middlewares/require-role.ts): `requireRole`
- [src/modules/payments/payments.routes.ts](../../src/modules/payments/payments.routes.ts): `paymentWebhookRoutes`
- [src/docs/openapi.ts](../../src/docs/openapi.ts)
