# Tổng quan dự án

Tài liệu này trả lời: LaptopShop API giải quyết bài toán gì, phục vụ ai và gồm những thành phần nào.

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

## Bài toán

LaptopShop API là backend JSON REST (`/api/v1`) cho một cửa hàng bán laptop trực tuyến. Một API duy nhất phục vụ cả storefront của khách hàng lẫn trang quản trị của nhân viên cửa hàng.

Dự án không dừng ở CRUD. Các bài toán thực tế mà code đang xử lý:

- Đặt hàng idempotent, tính giá phía server và trừ kho có điều kiện trong một transaction.
- Thanh toán chuyển khoản QR, nhận webhook và đối soát giao dịch bằng worker nền.
- Khuyến mãi (coupon, tự động, flash sale có quota) chịu được truy cập đồng thời.
- Sổ kho ghi lại mọi biến động tồn kho.
- Quy trình bảo hành và sửa chữa sau bán hàng.
- Thông báo đa kênh (email, Web Push, trong ứng dụng) qua outbox và hàng đợi.
- Tư vấn chọn laptop bằng AI, có phương án dự phòng theo luật khi AI không khả dụng.

## Đối tượng sử dụng

| Đối tượng | Dùng hệ thống để |
| --- | --- |
| Khách vãng lai | Xem catalog, đọc đánh giá, xem khuyến mãi, hỏi tư vấn, đăng ký nhận tin |
| Khách hàng (đã đăng nhập) | Giỏ hàng, đặt hàng, thanh toán, đánh giá, wishlist và cảnh báo giá, yêu cầu bảo hành, nhận thông báo |
| Quản trị viên | Quản lý sản phẩm, đơn hàng, kho, khuyến mãi, đánh giá, bảo hành, người dùng, banner, thông báo |
| Hệ thống / worker | Đối soát thanh toán, gửi thông báo, quét cảnh báo giá, xử lý mốc bảo hành |

Chi tiết ở [features-and-roles.md](features-and-roles.md).

## Phạm vi

Trong phạm vi: toàn bộ API dưới `/api/v1`, các worker nền, các script vận hành và schema database. Các nhóm nghiệp vụ được liệt kê ở [business-domain.md](business-domain.md).

Ngoài phạm vi: giao diện người dùng. Storefront và trang quản trị là repo riêng [laptopshop-web](https://github.com/QuocDuy21-10/laptopshop-web) (Next.js), giao tiếp với API qua HTTPS và cookie HttpOnly.

## Các thành phần chạy

Một lần triển khai gồm một tiến trình API và sáu worker, mỗi worker là một service riêng trong `docker-compose.yml`, cùng MySQL, Redis và object storage. Xem [container-diagram.md](../02-architecture/container-diagram.md).

## Nguồn

- [README.md](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/README.md)
- [src/routes/index.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/routes/index.ts): `createApiV1Router`
- [docker-compose.yml](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/docker-compose.yml)
- [src/modules/](https://github.com/QuocDuy21-10/laptopshop-api/tree/main/src/modules)
