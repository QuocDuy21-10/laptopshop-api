# ADR-0007: Pricing pipeline và quy tắc Flash Sale

> Đối chiếu code: main @ d3d4cb7 (2026-11-04)

- Trạng thái: Accepted
- Nguồn gốc: Tái dựng

## Bối cảnh

Giá một dòng hàng chịu ảnh hưởng của nhiều thứ cùng lúc: giá niêm yết, khuyến mãi tự động, flash sale có hạn mức, mã giảm giá. Các thứ này đổi theo thời gian và do admin sửa. Ba yêu cầu mâu thuẫn nhau nếu làm ngây thơ: giá khách thấy phải trùng giá khi đặt; không bán quá suất flash sale dù nhiều người mua cùng lúc; trang danh sách sản phẩm phải hiển thị giá khuyến mãi mà không tính lại từng sản phẩm mỗi lần.

Lịch sử commit cho biết quyết định xảy ra trong tuần 2026-10-22 đến 2026-10-27: `97a139f` "add deterministic pricing engine" (chọn khuyến mãi theo thứ tự ổn định, tính mã giảm giá và phân bổ nguyên, băm canonical các đầu vào), `1dad985` "apply promotion pricing atomically" (kiểm tra dấu vân tay báo giá và idempotency gắn với nội dung), `f3da5e0` và `d10b730` (giữ hạn mức flash sale nguyên tử), `adf64bf` (2026-10-27) "add catalog price window storage". Các commit nêu việc làm, không nêu lý do; phần lý do được suy ra từ code.

## Quyết định

**Thứ tự tính (hàm `calculatePromotionPricing`, thuần, không chạm DB):**

1. Giá niêm yết của sản phẩm (đọc lại dưới khoá hàng khi đặt hàng).
2. Mỗi sản phẩm lấy tối đa một khuyến mãi thắng trong các khuyến mãi tự động và flash sale đang chạy, chọn theo `priority`, rồi mức giảm mỗi đơn vị, rồi `id` (`comparePromotionCandidates`). Flash sale chỉ thắng khi còn đủ suất; thiếu suất thì rơi về ứng viên kế tiếp (`selectProductPromotion`).
3. Mã giảm giá tính trên phần còn lại của các dòng đủ điều kiện (dòng có khuyến mãi chỉ đủ điều kiện nếu `stackableWithCoupon`), chia cho từng dòng bằng số nguyên (phương pháp phần dư lớn nhất).
4. Giá cuối là tổng các dòng.

**Tính phía server, kiểm tra bằng dấu vân tay.** Client không gửi giá. `quoteOrder` trả `pricingFingerprint` = SHA-256 canonical của (các dòng cùng khuyến mãi thắng và phiên bản, mã giảm giá, các tổng tiền). Khi đặt hàng server tính lại và so; lệch thì `409 PROMOTION_CHANGED`, khách báo giá lại. Chi tiết: PRM-19 trong [promotions-and-flash-sale.md](../../04-business/promotions-and-flash-sale.md) và CHK-10 trong [checkout-and-payment.md](../../04-business/checkout-and-payment.md). Mỗi khuyến mãi có `pricingVersion` tăng khi trạng thái hoặc cấu hình giá đổi, là một phần của dấu vân tay và được kiểm tra lại khi giữ suất.

**Hạn mức flash sale giữ nguyên tử.** Trong transaction đặt hàng: mã giảm giá được giữ lượt trước, rồi flash sale (khoá `Promotion` theo `id` tăng dần để tránh deadlock, tăng bộ đếm bằng `UPDATE` có điều kiện), rồi mới trừ kho. Bảng `FlashSaleAllocation` là nguồn sự thật; bộ đếm có script kiểm tra (`pnpm run promotions:verify-flash-sale`). Huỷ đơn nhả suất đúng một lần.

> **Lưu ý:** thứ tự "mã giảm giá, flash sale, trừ kho" ở trên lấy từ `placeOrder` hiện tại. Thông điệp commit `d10b730` ghi "claim quota before coupon and stock"; code hiện tại claim mã giảm giá trước flash sale. Tài liệu theo code.

**Giá hiệu lực cho catalog được tính sẵn.** Trang danh sách không tính khuyến mãi mỗi lần. Bảng `CatalogPriceWindow` lưu, cho từng sản phẩm, các khoảng thời gian liền nhau với giá hiệu lực của khuyến mãi tự động (`buildCatalogPriceTimeline`, cắt ở mọi mốc bắt đầu và kết thúc). Bảng được dựng lại trong cùng transaction khi tạo, sửa, chuyển trạng thái khuyến mãi tự động (`refreshCatalogPriceWindows`) và có script dựng lại, kiểm tra. Flash sale và mã giảm giá không nằm trong bảng này vì phụ thuộc người mua và hạn mức còn lại.

**Module `pricing` riêng.** Phần giá hiệu lực của catalog (`src/modules/pricing/`) tách khỏi `promotions` (cấu hình và tính giá giỏ hàng) nhưng dùng lại cùng hàm chọn khuyến mãi tự động (`resolveAutomaticPromotionAt`), nên hai nơi không lệch nhau về quy tắc chọn.

## Phương án đã cân nhắc

> **Suy luận:** repo không ghi lại các phương án đã so sánh, nên các điểm dưới đây là suy luận từ cấu trúc code. (1) Tính khuyến mãi tại thời điểm đọc catalog: không cần bảng dẫn xuất nhưng mỗi lần liệt kê sản phẩm phải chạy lại việc chọn khuyến mãi; bảng cửa sổ giá đánh đổi thêm một bảng và một việc dựng lại để đọc nhanh và ổn định. (2) Tin giá do client gửi: đơn giản nhưng không an toàn; dấu vân tay cho client "ký" vào kết quả báo giá mà server vẫn là bên quyết định. (3) Khoá toàn cục cho hạn mức flash sale: đơn giản nhưng làm các đơn không liên quan xếp hàng; thiết kế hiện tại khoá theo `Promotion` và cập nhật có điều kiện theo từng (khuyến mãi, sản phẩm). Lý do tách `pricing` thành module riêng không được ghi ở đâu; đoạn trên là cách đọc code.

## Hệ quả (được / mất)

Được:

- Giá cuối đúng từng đồng, xác định (cùng đầu vào cho cùng kết quả), dễ kiểm thử đơn vị vì lõi tính giá là hàm thuần.
- Không bán quá suất flash sale và không vượt giới hạn mỗi người dù đặt đồng thời.
- Danh sách catalog đọc giá từ bảng tính sẵn.

Mất:

- Khách có thể gặp `PROMOTION_CHANGED` khi admin vừa đổi khuyến mãi; client phải biết báo giá lại.
- Có dữ liệu dẫn xuất cần giữ đúng: bộ đếm flash sale (đối chiếu với bảng phân bổ) và `CatalogPriceWindow` (đối chiếu bằng audit).
- Khoá `Promotion` và khoá hàng sản phẩm làm các đơn cùng khuyến mãi hoặc cùng sản phẩm xếp hàng nhau lúc đặt.
- Khuyến mãi đã kích hoạt khoá các trường thương mại (PRM-07), muốn đổi phải nhân bản làm bản nháp.

## Khi thành phần này lỗi

- Cửa sổ giá thiếu hoặc cũ: chạy `pnpm run catalog-pricing:audit` để liệt kê (`MISSING`, `OVERLAP`, `STALE_POLICY`, `LIST_PRICE_MISMATCH`), rồi `pnpm run catalog-pricing:rebuild -- --apply` để dựng lại (không có `--apply` chỉ đếm).
- Bộ đếm flash sale lệch bảng phân bổ: `pnpm run promotions:verify-flash-sale` liệt kê chỗ lệch; việc huỷ đơn bị chặn với `FLASH_SALE_COUNTER_MISMATCH` cho tới khi bộ đếm được sửa có kiểm soát.
- Dấu vân tay lệch lúc đặt: không phải sự cố, là cơ chế bảo vệ; khách báo giá lại.
- Một khuyến mãi cấu hình sai đang chạy: tạm dừng (`PAUSE`) hoặc kết thúc (`END`) làm `pricingVersion` tăng, đơn đang chờ báo giá cũ sẽ nhận `PROMOTION_CHANGED`.

## Nguồn

- [src/modules/promotions/promotion-pricing.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/promotions/promotion-pricing.ts): `calculatePromotionPricing`
- [src/modules/promotions/promotion-selection.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/promotions/promotion-selection.ts): `comparePromotionCandidates`, `selectProductPromotion`
- [src/modules/promotions/promotion-fingerprint.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/promotions/promotion-fingerprint.ts): `createPricingFingerprint`
- [src/modules/promotions/flash-sale-quota.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/promotions/flash-sale-quota.ts): `claimFlashSaleQuotas`, `releaseFlashSaleAllocations`
- [src/modules/promotions/promotions.service.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/promotions/promotions.service.ts): `quoteOrder`, `transitionPromotion`
- [src/modules/promotions/automatic-promotion-policy.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/promotions/automatic-promotion-policy.ts): `resolveAutomaticPromotionAt`
- [src/modules/orders/orders.service.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/orders/orders.service.ts): `placeOrder`
- [src/modules/pricing/catalog-price-timeline.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/pricing/catalog-price-timeline.ts): `buildCatalogPriceTimeline`
- [src/modules/pricing/catalog-price-projection.repository.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/modules/pricing/catalog-price-projection.repository.ts): `refreshCatalogPriceWindows`
- [src/scripts/rebuild-catalog-price-windows.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/scripts/rebuild-catalog-price-windows.ts)
- [src/scripts/verify-flash-sale.ts](https://github.com/QuocDuy21-10/laptopshop-api/blob/main/src/scripts/verify-flash-sale.ts)
