# 💻 Laptop Shop Website (Node.js + Express + TypeScript)

## Chạy development

```bash
cp .env.example .env          # điền DATABASE_URL, JWT_SECRET, SESSION_SECRET
npm install
npx prisma generate
npx prisma migrate dev
docker compose up -d mysql redis   # hoặc dùng MySQL/Redis có sẵn
npm run dev
```

Scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm start` (chạy `dist/`).
Mở Swagger tại `/api-docs` khi đặt `ENABLE_DOCS=true`.

## Production

```bash
cp .env.example .env   # đặt NODE_ENV, secrets, ADMIN_PASSWORD (>= 12 ký tự), MYSQL_*
docker compose up -d --build
```

- Bắt buộc: `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET` (>= 16 ký tự), `ADMIN_PASSWORD` (>= 12 ký tự khi `NODE_ENV=production`). Thiếu hoặc sai thì app không khởi động.
- Cookie session là `secure` ở production và app đặt `trust proxy = 1`: reverse proxy phải chạy HTTPS và gửi header `X-Forwarded-Proto`.
- `GET /healthz` (liveness) và `GET /readyz` (kiểm tra MySQL + Redis).
- `SENTRY_DSN` tùy chọn; không đặt thì Sentry tắt. `ENABLE_DOCS` mặc định tắt.
- Migration chạy tự động khi container khởi động (`prisma migrate deploy`).

## 🧩 Tính năng chính

- ✅ Trang chủ hiển thị danh sách sản phẩm
- 🔍 Tìm kiếm sản phẩm theo:
  - Giá cả
  - Số lượng
  - Nhà sản xuất
- 📄 Trang chi tiết sản phẩm
- 🛒 Giỏ hàng và đặt hàng
- ✅ Xác thực người dùng với Passport.js
- 📦 CRUD:
  - Người dùng (User)
  - Sản phẩm (Product)
  - Đơn hàng (Order)
- 🔐 Phân quyền truy cập (Admin / User)
- ✅ Thông báo khi mua hàng thành công

---

## 🛠️ Công nghệ & Cấu hình

| Công nghệ             | Mô tả                                                                 |
|----------------------|------------------------------------------------------------------------|
| **Node.js**          | Backend server                                                         |
| **Express.js**       | Web framework xử lý routing, middleware                                |
| **TypeScript**       | Hỗ trợ viết code an toàn, dễ bảo trì                                   |
| **EJS**              | Template engine hiển thị giao diện                                     |
| **Passport.js**      | Xác thực người dùng (authentication & authorization)                   |
| **Nodemon**          | Tự động reload server khi thay đổi code                                |
| **Prisma ORM**       | Giao tiếp với database thông qua schema rõ ràng và migrations          |
| **MySQL**            | Cơ sở dữ liệu chính để lưu thông tin người dùng, đơn hàng, sản phẩm    |
| **Multer**           | Upload hình ảnh (ví dụ: avatar người dùng, ảnh sản phẩm)               |

---


