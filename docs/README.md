# Tài liệu kỹ thuật LaptopShop API

Bộ tài liệu này giúp một người chưa biết LaptopShop hiểu dự án giải quyết bài toán gì, hệ thống gồm những thành phần nào và request đi qua chúng ra sao.

> Đối chiếu code: main @ d3d4cb7 (2026-11-04)

## Bắt đầu từ đâu

[README ở root](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/README.md) là trang giới thiệu và hướng dẫn chạy nhanh. Thư mục `docs/` đi sâu hơn; một số nội dung được nhắc lại ở cả hai nơi.

Thứ tự đọc đề xuất:

1. [project-overview.md](01-overview/project-overview.md): dự án làm gì, cho ai.
2. [business-domain.md](01-overview/business-domain.md): các nhóm nghiệp vụ và quan hệ giữa chúng.
3. [features-and-roles.md](01-overview/features-and-roles.md): ai được làm gì.
4. [architecture-overview.md](02-architecture/architecture-overview.md): bức tranh kiến trúc.
5. [request-lifecycle.md](02-architecture/request-lifecycle.md): một request đi qua những bước nào.
6. [background-jobs.md](02-architecture/background-jobs.md): worker, queue và outbox.

## Mục lục

| File | Trả lời câu hỏi |
| --- | --- |
| [01-overview/project-overview.md](01-overview/project-overview.md) | LaptopShop giải quyết bài toán gì, phạm vi đến đâu? |
| [01-overview/business-domain.md](01-overview/business-domain.md) | Có những nhóm nghiệp vụ nào, chúng phụ thuộc nhau ra sao? |
| [01-overview/features-and-roles.md](01-overview/features-and-roles.md) | Vai trò nào dùng được nhóm chức năng nào? |
| [01-overview/tech-stack.md](01-overview/tech-stack.md) | Dùng công nghệ gì, phiên bản bao nhiêu, để làm gì? |
| [01-overview/glossary.md](01-overview/glossary.md) | Các thuật ngữ trong dự án nghĩa là gì? |
| [02-architecture/architecture-overview.md](02-architecture/architecture-overview.md) | Kiến trúc tổng thể trông như thế nào? |
| [02-architecture/system-context.md](02-architecture/system-context.md) | C1: hệ thống tương tác với ai và dịch vụ ngoài nào? |
| [02-architecture/container-diagram.md](02-architecture/container-diagram.md) | C2: có những tiến trình và kho dữ liệu nào? |
| [02-architecture/component-diagram.md](02-architecture/component-diagram.md) | C3: một module trong API được tổ chức ra sao? |
| [02-architecture/request-lifecycle.md](02-architecture/request-lifecycle.md) | Request đi qua middleware nào, lỗi được xử lý ra sao? |
| [02-architecture/background-jobs.md](02-architecture/background-jobs.md) | Worker, queue, outbox và script vận hành hoạt động thế nào? |
| [02-architecture/integration-architecture.md](02-architecture/integration-architecture.md) | Các tích hợp ngoài cấu hình thế nào, khi lỗi thì sao? |
| [02-architecture/decisions/README.md](02-architecture/decisions/README.md) | Danh sách và template ADR |
| [ADR-0001](02-architecture/decisions/0001-express-5.md) | Vì sao Express 5? |
| [ADR-0002](02-architecture/decisions/0002-prisma-mysql.md) | Vì sao Prisma + MySQL? |
| [ADR-0003](02-architecture/decisions/0003-redis-bullmq.md) | Vì sao Redis + BullMQ? |
| [ADR-0004](02-architecture/decisions/0004-transactional-outbox.md) | Vì sao dùng transactional outbox? |
| [ADR-0005](02-architecture/decisions/0005-idempotency.md) | Idempotency được làm thế nào ở các thao tác ghi quan trọng? |
| [ADR-0006](02-architecture/decisions/0006-stock-ledger.md) | Vì sao có sổ kho? |
| [ADR-0007](02-architecture/decisions/0007-pricing-pipeline.md) | Giá được tính theo thứ tự nào, flash sale giữ suất ra sao? |
| [02-architecture/database-architecture.md](02-architecture/database-architecture.md) | MySQL nằm ở đâu trong kiến trúc, dữ liệu nằm ở đâu? |
| [03-database/README.md](03-database/README.md) | Dữ liệu gồm những bảng nào, đọc data dictionary thế nào? |
| [03-database/contexts/](03-database/contexts/identity-accounts.md) | ERD và mô tả từng cột của 52 model, chia 8 nhóm |
| [03-database/enums.md](03-database/enums.md) | 30 enum và các trạng thái lưu bằng `VARCHAR` |
| [03-database/relationships.md](03-database/relationships.md) | Khoá ngoại, `onDelete`, phụ thuộc giữa các nhóm |
| [03-database/constraints-and-indexes.md](03-database/constraints-and-indexes.md) | Unique, index, ràng buộc chỉ có trong migration |
| [03-database/transactions-and-locking.md](03-database/transactions-and-locking.md) | Dữ liệu nào được bảo vệ khỏi ghi đồng thời, bằng cơ chế gì? |
| [03-database/migrations.md](03-database/migrations.md) | Cách chạy migration và 48 migration theo chủ đề |
| [04-business/README.md](04-business/README.md) | Có những nghiệp vụ nào, mã quy tắc đọc thế nào? |
| [04-business/inventory.md](04-business/inventory.md) | Tồn kho đổi theo quy tắc nào, phiếu nhập hoạt động ra sao? |
| [04-business/checkout-and-payment.md](04-business/checkout-and-payment.md) | Giỏ hàng thành đơn và thanh toán QR được xác nhận thế nào? |
| [04-business/promotions-and-flash-sale.md](04-business/promotions-and-flash-sale.md) | Khuyến mãi, mã giảm giá, flash sale được cấu hình và tính thế nào? |
| [04-business/after-sales.md](04-business/after-sales.md) | Bảo hành và hỗ trợ kỹ thuật vận hành ra sao? |

## Lộ trình tài liệu

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| 1. Foundation | `01-overview/`, `02-architecture/` | Có (tài liệu này) |
| 2. Database | ERD, data dictionary, constraints, transactions, migrations | Có |
| 3. Business | Use case, workflow, sequence, state machine cho các nghiệp vụ chính | Có (P0) |
| 4. Developer & Ops | API conventions, từng module, bảo mật, kiểm thử, vận hành | Chưa có |
| 5. Automation | Kiểm tra link, Mermaid và nhắc cập nhật docs trong CI | Chưa có |

## Quy ước viết tài liệu

1. **Đầu file:** tiêu đề, một đến hai câu nói file trả lời câu hỏi gì, rồi dòng `> Đối chiếu code: main @ <sha> (YYYY-MM-DD)`. Các con số dễ lỗi thời (số model, số worker) chỉ đúng tại commit này.
2. **Cuối file:** mục `## Nguồn` với link tương đối tới file source và tên symbol. Không link tới số dòng.
3. **Phân biệt nguồn gốc:** điều đọc trực tiếp từ code viết bình thường. Lý do suy ngược từ code nằm trong khối `> **Suy luận:** …`. ADR có thêm trường `Nguồn gốc: Đã xác nhận | Tái dựng`.
4. **Sơ đồ:** dùng Mermaid `flowchart` với `subgraph` theo phong cách C4 (không dùng cú pháp `C4Context`, vì còn experimental) và `sequenceDiagram` cho luồng tương tác. Mỗi sơ đồ tối đa khoảng 15 node. Đường đồng bộ vẽ nét liền, đường bất đồng bộ (queue, outbox, webhook) vẽ nét đứt.
5. **Một nguồn chính:** API contract nằm ở OpenAPI ([src/docs/openapi.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/docs/openapi.ts), `/api-docs` khi `ENABLE_DOCS=true`), tài liệu không chép lại. Chi tiết field nằm ở [03-database/](03-database/README.md).
6. **Bảo mật:** chỉ ghi tên biến môi trường và ý nghĩa, không ghi giá trị thật. Không đưa secret, tài khoản hay dữ liệu khách hàng vào tài liệu.
7. **Template ADR:** xem [decisions/README.md](02-architecture/decisions/README.md).

## Cập nhật tài liệu

| Khi thay đổi | Cập nhật |
| --- | --- |
| Route dưới `/api/v1` | `src/docs/openapi.ts` (và [features-and-roles.md](01-overview/features-and-roles.md) nếu đổi quyền truy cập) |
| Middleware hoặc thứ tự trong `src/app.ts` | [request-lifecycle.md](02-architecture/request-lifecycle.md) |
| Thêm hoặc bớt worker, queue | [background-jobs.md](02-architecture/background-jobs.md) và [container-diagram.md](02-architecture/container-diagram.md) |
| Tích hợp ngoài hoặc biến môi trường | [integration-architecture.md](02-architecture/integration-architecture.md) |
| Module mới | [business-domain.md](01-overview/business-domain.md) |
| `prisma/schema.prisma` (model, cột, enum, quan hệ, index) | Mục tương ứng trong [03-database/contexts/](03-database/contexts/identity-accounts.md), [enums.md](03-database/enums.md), [relationships.md](03-database/relationships.md), [constraints-and-indexes.md](03-database/constraints-and-indexes.md) |
| Migration mới | [migrations.md](03-database/migrations.md) |
| Quy tắc nghiệp vụ trong code (checkout, thanh toán, kho, khuyến mãi, hậu mãi) | Bảng quy tắc và bảng truy vết tương ứng ở [04-business/](04-business/README.md), rồi chạy lại các kiểm tra tài liệu |

Sau khi cập nhật, đổi commit ở dòng `Đối chiếu code` của file đó.

## Nguồn

- [README.md](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/README.md)
- [src/docs/openapi.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/docs/openapi.ts)
- [prisma/schema.prisma](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/prisma/schema.prisma)
