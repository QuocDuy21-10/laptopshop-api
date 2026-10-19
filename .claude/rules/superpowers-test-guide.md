# Hướng dẫn test local sau spec và plan superpowers

- Sau khi viết xong spec và plan bằng các skill superpowers, luôn viết thêm một file hướng dẫn test local bằng Markdown (tiếng Việt, cùng slug ngày-chủ đề với spec và plan) vào `docs/superpowers/test-guides/`, trong cùng commit.
- Backend: hướng dẫn test thủ công từng bước qua Swagger UI tại `/api-docs` (cần `ENABLE_DOCS=true`): cách đăng nhập/authorize, endpoint cần gọi, body request mẫu, status và response mong đợi.
- Frontend: hướng dẫn test từng bước trên giao diện local: cách chạy UI, các trang/luồng cần thao tác, kết quả mong đợi.
- Cả hai loại đều phải bao gồm các trường hợp lỗi nêu trong spec.
