# Migration

Tài liệu này trả lời: cách chạy migration, quy ước đang dùng và 48 migration của schema hiện tại thay đổi những gì.

> Đối chiếu code: main @ 0f1eab2 (2026-11-04)

## Cách chạy

| Môi trường | Lệnh | Ghi chú |
| --- | --- | --- |
| Phát triển local | `pnpm exec prisma migrate dev` | Tạo migration mới từ thay đổi của `schema.prisma` và áp dụng |
| Sinh client | `pnpm exec prisma generate` | Cần sau khi schema đổi |
| Triển khai | `pnpm exec prisma migrate deploy` | Chỉ áp dụng migration đã có, không tạo mới. Container chạy lệnh này trong `docker/entrypoint.sh` khi `RUN_MIGRATIONS` khác `false`, rồi chạy seed (chỉ chèn vào bảng trống) |
| Script npm | `pnpm run prisma:deploy` | Bí danh của `migrate deploy` |

`prisma/migrations/migration_lock.toml` cố định nhà cung cấp là `mysql`.

## Quy ước

- Mỗi thư mục `prisma/migrations/<thời gian>_<tên>/migration.sql` là một migration; có **48 thư mục** tại baseline này (README ở root ghi 49, có thể đã tính cả `migration_lock.toml`).
- Tên migration dạng `snake_case`; có đúng một migration không có tên (phần sau dấu gạch dưới để trống, nằm ở nhóm Thanh toán bên dưới).
- Nhiều thay đổi lớn được tách thành hai bước *expand* rồi *contract*: bước đầu thêm cột hoặc bảng mới và điền dữ liệu, bước sau mới siết ràng buộc hoặc xoá phần cũ. Các cặp thấy trong lịch sử: `promotions_expand` và `promotions_contract`, `inventory_core_receipts_expand` và `inventory_balance_contract`; `flash_sale_quota_expand` và `wishlist_notification_v2_expand` mang hậu tố *expand*.
- Migration có SQL thủ công (chèn hoặc cập nhật dữ liệu, ràng buộc `CHECK`) được đánh dấu **có dữ liệu** trong bảng dưới. Sáu migration thuộc loại này: `cart_unique_line`, `stock_movements`, `inventory_balance_contract`, `add_order_warranty_snapshot`, `checkout_qr_review_remediation`, `promotions_expand`.
- Ràng buộc chỉ có trong migration (không có trong `schema.prisma`) được ghi ở [constraints-and-indexes.md](constraints-and-indexes.md#ràng-buộc-chỉ-có-trong-migration).

> **Suy luận:** cặp *expand/contract* nhằm cho phép triển khai ứng dụng và schema không đồng thời mà không gián đoạn; repo không có tài liệu nào xác nhận quy ước này.

## Danh sách migration

Gom theo chủ đề; trong mỗi nhóm giữ đúng thứ tự thời gian.


### Nền tảng ban đầu (tháng 7 năm 2025)

| Migration | Nội dung |
| --- | --- |
| `20250707091309_init` | Bảng `User` đầu tiên; bị thay ở migration kế tiếp. |
| `20250707140039_init_project` | Xoá bảng `User`, tạo `users`, `roles`, `products`. |
| `20250711021510_relation_user_role` | Thêm `users.roleId` và khoá ngoại tới `roles`. |
| `20250715034539_update_sold` | `products.sold` cho phép rỗng, mặc định 0. |
| `20250715123821_update_detail_desc` | `products.detailDesc` đổi sang `MEDIUMTEXT`. |
| `20250715144447_update_unquie` | Unique cho `roles.name` và `users.username`. |
| `20250717092956_add_session` | Tạo bảng `Session` (bị xoá ở `cleanup_legacy`). |
| `20250719084257_add_cart_cart_detail` | Tạo `cart` và `cart_detail`. |
| `20250720133620_add_oder_oder_detail` | Thêm `orders.paymentMethod`, tạo `order_detail` và khoá ngoại của đơn hàng. |

### Đăng nhập, giỏ hàng, đơn hàng nền (18/10/2026)

| Migration | Nội dung |
| --- | --- |
| `20261018035222_refresh_tokens` | Tạo `refresh_tokens`. |
| `20261018035710_cart_unique_line` | **Có dữ liệu:** gộp các dòng giỏ trùng sản phẩm (giữ id nhỏ nhất, cộng số lượng) để tạo được unique `(cartId, productId)`. |
| `20261018035833_order_idempotency` | Thêm `orders.createdAt` và unique `(userId, idempotencyKey)`. |
| `20261018043226_cleanup_legacy` | Xoá bảng `Session`, cột `cart.sum` và `cart_detail.price`. README khuyên backup trước khi deploy. |

### Đơn hàng và sổ kho

| Migration | Nội dung |
| --- | --- |
| `20261019075234_product_is_active` | Thêm `products.isActive`. |
| `20261019075822_order_list_indexes` | Index `orders(status, createdAt)` và `orders(createdAt)`. |
| `20261019095046_order_status_history` | Thêm `orders.completedAt`, tạo `order_status_history`. |
| `20261019095518_stock_movements` | Tạo `stock_movements`. **Có dữ liệu:** chèn dòng `OPENING` cho mỗi sản phẩm đang có tồn kho khác 0. |
| `20261020173000_inventory_core_receipts_expand` | Giai đoạn *expand* của phiếu nhập: tạo `stock_receipts`, `stock_receipt_items`, thêm cột vào `stock_movements`. |
| `20261020193000_inventory_balance_contract` | Giai đoạn *contract*: **có dữ liệu**, tính lại `balanceBefore` và `balanceAfter` cho các dòng sổ kho cũ bằng tổng luỹ kế `delta`, rồi đặt hai cột `NOT NULL`. |
| `20261028100000_add_stock_receipt_version` | Thêm `stock_receipts.version` cho khoá lạc quan. |

### Sản phẩm

| Migration | Nội dung |
| --- | --- |
| `20261019120000_product_specs` | Thêm các cột thông số kỹ thuật vào `products`. |
| `20261020220000_add_product_facets` | Thêm các cột phân loại (`cpuBrand`, `gpuBrand`, `gpuType`, `resolutionTier`, …) cho bộ lọc. |

### Thanh toán

| Migration | Nội dung |
| --- | --- |
| `20261019130000_add_payments` | Tạo `payments`, `payment_webhook_events`, `payment_provider_checkpoints`; thêm `order_status_history.reason`. |
| `20261021151311_` | (Tên migration để trống.) Tạo lại khoá ngoại `payment_webhook_events.paymentId` (cho phép rỗng, `SET NULL`) và `stock_receipts.postedById` (`SET NULL`). |
| `20261024150000_checkout_qr_review_remediation` | Sửa sau review thanh toán QR: tạo `payment_review_cases`, `payment_review_actions`, **có dữ liệu** điền lại `payments` và `payment_webhook_events`, đổi khoá unique của sự kiện sang `(provider, providerMode, …)`. Khoá ngoại `payment_review_cases.paymentId` được tạo với `ON DELETE CASCADE`. |

### Đánh giá sản phẩm

| Migration | Nội dung |
| --- | --- |
| `20261021040546_add_product_reviews` | Tạo `reviews`, kèm ràng buộc `CHECK` cho `rating`. |
| `20261021100000_add_review_images` | Tạo `review_images`. |
| `20261021110000_add_review_helpful` | Tạo `review_helpful`. |
| `20261021120000_add_review_replies` | Tạo `review_replies`. |
| `20261026120000_add_review_image_sync_operations` | Tạo `review_image_sync_operations`, thêm `reviews.imageVersion` và các cột đồng bộ vào `review_images`. |

### Khuyến mãi và giá

| Migration | Nội dung |
| --- | --- |
| `20261022014612_promotions_expand` | Giai đoạn *expand*: tạo `promotions`, `coupon_policies`, `automatic_promotion_policies`, `promotion_products`, …; thêm cột khuyến mãi vào `orders`, `order_detail`; **có dữ liệu** điền lại các cột này cho đơn cũ. |
| `20261022014637_promotions_contract` | Giai đoạn *contract*: siết `orders.subtotalPrice` thành `NOT NULL`. |
| `20261022041310_flash_sale_quota_expand` | Thêm `FLASH_SALE` vào `promotions.kind`, tạo các bảng flash sale (`flash_sale_policies`, `flash_sale_product_quotas`, `flash_sale_user_usages`, …). |
| `20261027100000_add_catalog_price_windows` | Tạo `catalog_price_windows`. |

### Wishlist, thông báo và xác minh email

| Migration | Nội dung |
| --- | --- |
| `20261022090241_add_wishlist_price_alerts` | Tạo `wishlist_items` và `notifications`. |
| `20261023031939_wishlist_notification_v2_expand` | Thêm `notifications.priceSource`, `users.emailVerifiedAt`, `wishlist_items.alertVersion`; tạo `notification_preferences`, `email_verification_challenges`, `push_subscriptions`, `notification_deliveries`, `notification_delivery_audits`, `outbox_events`, `worker_heartbeats`. |
| `20261029100000_add_email_challenge_purpose` | Thêm `email_verification_challenges.purpose` (xác minh email hoặc đặt lại mật khẩu). |

### Worker nền

| Migration | Nội dung |
| --- | --- |
| `20261024090000_add_worker_checkpoints` | Tạo `worker_checkpoints`. |
| `20261024091000_add_worker_checkpoint_epoch` | Thêm `worker_checkpoints.ownerEpoch`. |

### Bảo hành sau bán

| Migration | Nội dung |
| --- | --- |
| `20261023120000_add_order_warranty_snapshot` | Thêm các cột bảo hành vào `order_detail` (`warrantyMonthsSnapshot`, `warrantyStartAt`, `warrantyEndAt`, …); **có dữ liệu** điền cho dòng đơn cũ. |
| `20261023121000_add_after_sales_core` | Tạo `service_requests`, `service_request_items`, `service_request_events`, … và thêm giá trị cho `warrantyPolicySource`. |
| `20261023122000_add_after_sales_notifications` | Mở rộng `notifications` và `notification_preferences` cho thông báo bảo hành. |
| `20261023123000_add_after_sales_outbox_event` | Mở rộng `outbox_events` cho sự kiện bảo hành. |
| `20261023124000_add_warranty_verification` | Tạo `warranty_verifications`. |
| `20261023125000_harden_after_sales_attachments` | Thêm các cột tải lên idempotent vào `service_request_attachments`. |
| `20261023130000_add_after_sales_attachment_cleanup_event` | Thêm sự kiện dọn ảnh đính kèm vào `service_request_events` và `outbox_events`. |

### Trang chủ và bản tin

| Migration | Nội dung |
| --- | --- |
| `20261101100000_add_home_banners` | Tạo `home_banners`. |
| `20261101110000_add_newsletter_subscribers` | Tạo `newsletter_subscribers`. |

## Nguồn

- [prisma/migrations/](https://github.com/QuocDuy21-10/laptopshop-api/tree/main/prisma/migrations)
- [prisma/migrations/migration_lock.toml](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/prisma/migrations/migration_lock.toml)
- [docker/entrypoint.sh](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/docker/entrypoint.sh)
- [package.json](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/package.json): `prisma:deploy`
- [README.md](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/README.md)
