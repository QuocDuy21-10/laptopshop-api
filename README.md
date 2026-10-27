# Laptop Shop API (Node.js + Express + TypeScript)

REST API JSON (`/api/v1`) cho Laptop Shop. Giao diện storefront và admin nằm ở repo riêng [laptopshop-web](https://github.com/QuocDuy21-10/laptopshop-web).

## Chạy development

```bash
cp .env.example .env          # điền DATABASE_URL, JWT_SECRET
pnpm install
pnpm exec prisma generate
docker compose up -d mysql redis rustfs rustfs-init
pnpm exec prisma migrate dev
pnpm run seed
pnpm run dev
```

Scripts: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm start`.
Mở Swagger tại `/api-docs` khi đặt `ENABLE_DOCS=true`.

Review images dùng RustFS local (`http://localhost:9000`, bucket private `laptopshop-review-images`); API không mount upload volume cho review images. Production dùng AWS S3/R2 hoặc S3-compatible storage với cùng adapter và credentials/policy riêng.

Reconciliation ảnh review có thể chạy thủ công hoặc đặt trong scheduler của môi trường deploy:

```bash
pnpm run review-images:reconcile
```

Command chỉ xoá object của row `PENDING/DELETING` đã đủ điều kiện; row `READY` mất object được báo cáo để vận hành xử lý, không tự xoá dữ liệu database.

## Production

```bash
cp .env.example .env   # NODE_ENV, secrets, ADMIN_PASSWORD (>= 12 ký tự), CORS_ORIGINS, COOKIE_DOMAIN, MYSQL_*
docker compose up -d --build
```

- Bắt buộc: `DATABASE_URL`, `JWT_SECRET` (>= 16 ký tự), `ADMIN_PASSWORD` (>= 12 ký tự khi `NODE_ENV=production`). Thiếu hoặc sai thì app không khởi động.
- Cookie đăng nhập là `Secure` ở production và app đặt `trust proxy = 1`: reverse proxy phải chạy HTTPS và gửi header `X-Forwarded-Proto`.
- Frontend và API phải cùng site (ví dụ `shop.com` + `api.shop.com`); đặt origin của frontend vào `CORS_ORIGINS`.
- `GET /healthz` (liveness) và `GET /readyz` (kiểm tra MySQL + Redis).
- Container tự chạy `prisma migrate deploy` và seed (chỉ chèn vào bảng đang trống) khi khởi động. Nên backup database trước khi deploy migration `cleanup_legacy` (xoá bảng `Session`, cột `cart.sum` và `cart_detail.price`).
- `SENTRY_DSN` tùy chọn; không đặt thì Sentry tắt. `ENABLE_DOCS` mặc định tắt.

## 🧩 Tính năng chính

- ✅ API danh sách và chi tiết sản phẩm
- 🔍 Tìm kiếm sản phẩm theo:
  - Giá cả
  - Số lượng
  - Nhà sản xuất
- 🛒 Giỏ hàng và đặt hàng
- ✅ Xác thực JWT trong cookie HttpOnly, refresh token xoay vòng
- 📦 CRUD:
  - Người dùng (User)
  - Sản phẩm (Product)
  - Đơn hàng (Order)
- 🔐 Phân quyền truy cập (Admin / User)
- ✅ Đặt hàng idempotent, huỷ đơn và hoàn kho

---

## 🛠️ Công nghệ & Cấu hình

| Công nghệ             | Mô tả                                                                 |
|----------------------|------------------------------------------------------------------------|
| **Node.js**          | Backend server                                                         |
| **Express.js**       | Web framework xử lý routing, middleware                                |
| **TypeScript**       | Hỗ trợ viết code an toàn, dễ bảo trì                                   |
| **JWT**              | Access token ngắn hạn + refresh token xoay vòng (lưu hash trong MySQL)  |
| **Nodemon**          | Tự động reload server khi thay đổi code                                |
| **Prisma ORM**       | Giao tiếp với database thông qua schema rõ ràng và migrations          |
| **MySQL**            | Cơ sở dữ liệu chính để lưu thông tin người dùng, đơn hàng, sản phẩm    |
| **Multer**           | Upload hình ảnh (ví dụ: avatar người dùng, ảnh sản phẩm)               |

---

