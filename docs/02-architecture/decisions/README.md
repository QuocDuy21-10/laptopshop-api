# Architecture Decision Records (ADR)

Tài liệu này trả lời: các quyết định kiến trúc quan trọng được ghi lại ở đâu, khi nào cần viết ADR mới và ADR có cấu trúc thế nào.

> Đối chiếu code: main @ 794f0a1 (2026-11-01)

## Khi nào viết ADR

Viết ADR khi một quyết định khó đảo ngược hoặc ảnh hưởng nhiều module: đổi công nghệ nền, thêm một pattern xuyên module, hoặc chọn một đánh đổi mà người đọc sau này sẽ thắc mắc. Không cần ADR cho thay đổi cục bộ trong một module.

## Danh sách

| ADR | Quyết định | Trạng thái | Nguồn gốc |
| --- | --- | --- | --- |
| [0001](0001-express-5.md) | Express 5 cho API | Accepted | Tái dựng |
| [0002](0002-prisma-mysql.md) | Prisma ORM với MySQL | Accepted | Tái dựng |
| [0003](0003-redis-bullmq.md) | Redis và BullMQ cho rate limit và việc nền | Accepted | Tái dựng |
| [0004](0004-transactional-outbox.md) | Transactional Outbox cho việc nền | Accepted | Tái dựng |
| [0005](0005-idempotency.md) | Idempotency cho thao tác ghi quan trọng | Accepted | Tái dựng |
| [0006](0006-stock-ledger.md) | Sổ kho (stock movement ledger) | Accepted | Tái dựng |
| [0007](0007-pricing-pipeline.md) | Pricing pipeline và quy tắc Flash Sale | Accepted | Tái dựng |
| 0008 | Object storage tương thích S3 cho ảnh | Dự kiến, giai đoạn tài liệu vận hành | |
| 0009 | Fallback theo luật cho AI Advisor | Dự kiến, giai đoạn tài liệu nghiệp vụ | |

Các ADR 0008 và 0009 chưa được viết vì cần đọc kỹ module liên quan trước.

## Trạng thái và nguồn gốc

- **Trạng thái:** `Accepted` hoặc `Superseded by ADR-YYYY`.
- **Nguồn gốc:** `Đã xác nhận` khi lý do được ghi rõ ở nơi có thể kiểm chứng (ví dụ commit message nêu mục đích). `Tái dựng` khi lý do được suy ngược từ code hiện tại; phần suy luận nằm trong khối `> **Suy luận:** …`.

Lịch sử commit của repo cho biết quyết định xảy ra khi nào, nhưng phần lớn commit đầu chỉ có tiêu đề ngắn, nên lý do thường là `Tái dựng`.

## Template

```markdown
# ADR-XXXX: <Tiêu đề>

- Trạng thái: Accepted | Superseded by ADR-YYYY
- Nguồn gốc: Đã xác nhận | Tái dựng

## Bối cảnh

## Quyết định

## Phương án đã cân nhắc

## Hệ quả (được / mất)

## Khi thành phần này lỗi

## Nguồn
```

Mỗi ADR cũng bắt đầu bằng dòng `> Đối chiếu code: main @ <sha> (YYYY-MM-DD)` như mọi tài liệu khác (xem [quy ước](../../README.md#quy-ước-viết-tài-liệu)).

## Nguồn

- [ADR-0001](0001-express-5.md)
- [ADR-0002](0002-prisma-mysql.md)
- [ADR-0003](0003-redis-bullmq.md)
- [ADR-0004](0004-transactional-outbox.md)
- [ADR-0005](0005-idempotency.md)
- [ADR-0006](0006-stock-ledger.md)
- [ADR-0007](0007-pricing-pipeline.md)
