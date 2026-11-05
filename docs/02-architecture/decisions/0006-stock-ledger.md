# ADR-0006: Sổ kho (stock movement ledger)

> Đối chiếu code: main @ 0f1eab2 (2026-11-04)

- Trạng thái: Accepted
- Nguồn gốc: Tái dựng

## Bối cảnh

Tồn kho của một sản phẩm đổi vì nhiều lý do: khách đặt hàng, đơn bị huỷ, nhập hàng, admin điều chỉnh. Nếu chỉ giữ một cột `Product.quantity`, mỗi lần đổi chỉ để lại con số mới; không biết số đó đến từ đâu, không kiểm tra được khi nghi ngờ lệch, và khó chống ghi lặp khi client gửi lại.

Lịch sử commit cho biết quyết định xảy ra trong hai ngày:

- Commit `ca0defc` (2026-10-19), "sổ kho StockMovement, mọi thay đổi tồn kho đi qua moveStock", thêm model `StockMovement` và quy tắc mọi thay đổi tồn kho đi qua hàm `moveStock`.
- Commit `bfd8efc` (2026-10-20), "enforce inventory ledger contract", siết hợp đồng của sổ (xem migration `inventory_balance_contract`: tính lại và đặt `NOT NULL` cho `balanceBefore`, `balanceAfter`).
- Commit `69d677f` (2026-10-20), "add inventory receipt schema", thêm phiếu nhập kho dựa trên sổ này.

Các commit nêu quy tắc, không nêu lý do; phần lý do bên dưới được suy ra từ code.

## Quyết định

Mỗi biến động tồn kho là một dòng `StockMovement` bất biến (chỉ thêm), gồm `delta`, `balanceBefore`, `balanceAfter`, `reason`, người thực hiện và đơn hoặc phiếu nhập liên quan. `Product.quantity` vẫn được giữ làm số dư hiện tại để đọc nhanh, nhưng chỉ đổi qua `moveStock` trong cùng transaction với việc ghi dòng sổ. Bất biến: với mỗi sản phẩm, `Product.quantity = SUM(StockMovement.delta)`.

- Trừ kho là `UPDATE … WHERE quantity >= qty`, nên không bán vượt tồn dù nhiều đơn đồng thời; số dư sau được đọc lại trong cùng transaction.
- Điều chỉnh của admin có `idempotencyKey` và `requestHash`, unique theo `(actorId, idempotencyKey)`.
- Bất biến được kiểm tra bằng `pnpm run inventory:verify-ledger` (`findLedgerMismatches`).
- Migration `stock_movements` chèn dòng `OPENING` cho tồn kho có sẵn để bất biến đúng ngay từ đầu.

Chi tiết cột ở [inventory.md](../../03-database/contexts/inventory.md).

## Phương án đã cân nhắc

> **Suy luận:** repo không ghi lại các phương án đã so sánh. Hai phương án hợp lý: (1) chỉ giữ `Product.quantity`, đơn giản nhưng không có lịch sử và không đối chiếu được; (2) event sourcing đầy đủ, trong đó tồn kho luôn được tính từ sổ, đúng đắn tuyệt đối nhưng mỗi lần đọc phải cộng dồn hoặc cần bảng tổng hợp. Thiết kế hiện tại là phương án lai: sổ là lịch sử, `quantity` là số dư tổng hợp, kiểm tra chéo bằng script.

## Hệ quả

Được:

- Truy vết được mọi thay đổi tồn kho (ai, khi nào, lý do, đơn nào).
- Phát hiện lệch giữa tồn kho và sổ bằng một truy vấn.
- Điều chỉnh của admin idempotent; nhập kho (`StockReceipt`) tái sử dụng cùng đường đi `moveStock`.

Mất:

- Mỗi thay đổi tồn kho ghi hai nơi (`Product` và `StockMovement`), tăng tải ghi và độ dài transaction.
- Hàng được cập nhật nóng: `Product` bị khoá hàng khi checkout nên các đơn cùng sản phẩm xếp hàng nhau.
- Bất biến do code bảo đảm, không có ràng buộc ở mức database (không có trigger); ghi thẳng vào `products.quantity` bằng SQL sẽ làm lệch mà database không chặn.

## Khi thành phần này lỗi

- Nếu `moveStock` ném lỗi, transaction của nơi gọi (đặt hàng, huỷ đơn, ghi sổ phiếu nhập) bị huỷ, nên tồn kho và sổ không lệch nhau.
- Nếu tồn kho và sổ lệch (do sửa tay hoặc lỗi), `pnpm run inventory:verify-ledger` liệt kê sản phẩm lệch (`productId`, `quantity`, `ledgerQuantity`) và thoát với mã lỗi 1. Script chỉ báo cáo, không tự sửa.

## Nguồn

- [prisma/schema.prisma](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/prisma/schema.prisma): `StockMovement`, `StockReceipt`, `StockReceiptItem`
- [src/modules/inventory/inventory.service.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/inventory/inventory.service.ts): `moveStock`, `adjustStock`
- [src/modules/inventory/inventory.reconciliation.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/inventory/inventory.reconciliation.ts): `findLedgerMismatches`
- [src/scripts/verify-stock-ledger.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/scripts/verify-stock-ledger.ts)
- [prisma/migrations/20261019095518_stock_movements/migration.sql](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/prisma/migrations/20261019095518_stock_movements/migration.sql)
- [prisma/migrations/20261020193000_inventory_balance_contract/migration.sql](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/prisma/migrations/20261020193000_inventory_balance_contract/migration.sql)
