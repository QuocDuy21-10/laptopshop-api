# Bộ lọc thông số kỹ thuật nâng cao và dynamic facets: thiết kế

Ngày: 2026-10-20
Branch: `codex/advanced-product-facets-design` (cắt từ `main`)
Nguồn: `docs-local/plan/filter-advance.md`

## 1. Mục tiêu

Mở rộng trang danh sách laptop thành hệ thống dynamic faceted search. Người dùng có thể kết hợp toàn bộ thông số sản phẩm, thấy số sản phẩm khả dụng ở từng lựa chọn và không bị dẫn vào những lựa chọn chắc chắn không có kết quả.

Tính năng phải đạt các kết quả sau:

1. Giữ URL là nguồn sự thật của bộ lọc đã áp dụng để reload, bookmark, chia sẻ và Back/Forward hoạt động đúng.
2. Dùng quy tắc OR trong cùng nhóm, AND giữa các nhóm.
3. Facet count dùng self-excluding semantics: khi tính một nhóm, áp dụng mọi điều kiện khác nhưng bỏ điều kiện của chính nhóm đó.
4. Option chưa chọn có count bằng 0 bị vô hiệu hóa; option đang chọn luôn có thể bỏ chọn.
5. Desktop cập nhật ngay qua URL; mobile cho phép chỉnh draft, xem trước tổng kết quả rồi áp dụng một lần.
6. CPU, GPU, độ phân giải và loại tấm nền dùng dữ liệu chuẩn hóa; không phụ thuộc vào substring mô tả trong truy vấn production.
7. Tận dụng Express, Zod, Prisma, MySQL, OpenAPI và Next.js hiện có; không thêm Elasticsearch, EAV, JSON specifications hoặc search service riêng.
8. Giữ tương thích với Header, Admin Product Form và các client đang dùng `/api/v1/products/filters`.

Repo `laptopshop-api` chịu trách nhiệm taxonomy, validation, query semantics, aggregate counts, audit và backfill. Repo `laptopshop-web` chịu trách nhiệm URL state, desktop/mobile interaction, active chips và trạng thái khả dụng của option.

## 2. Hiện trạng đã kiểm chứng

Backend đã có các nền tảng cần thiết:

- `Product` có CPU, GPU, RAM, dung lượng, kích thước và độ phân giải màn hình, tần số quét, pin, trọng lượng và bảo hành.
- `listProductsQuery` đã hỗ trợ hãng, nhu cầu, giá, sort và tìm theo tên.
- `productWhere()` là boundary dùng chung cho public list, admin list và CSV export.
- `/api/v1/products/filters` đang trả `factoryOptions` và `targetOptions` cho storefront, Header và Admin Form.
- OpenAPI được sinh thủ công từ Zod; web sinh `src/lib/api/schema.d.ts` từ contract này.
- MySQL dùng collation không phân biệt hoa thường, nhưng substring CPU/GPU vẫn không đủ chính xác để làm nguồn dữ liệu facet lâu dài.

Frontend đã có:

- Server Component cho `/products`.
- URL parser/serializer trong `features/products/search-params.ts`.
- Sidebar desktop, Radix Dialog sheet trên mobile và active filter chips.
- API browser same-origin qua Next rewrite trong development và nginx trong production.
- TanStack Query cho client-side request state.

Các khoảng trống hiện tại:

- Filter UI tự gọi router nên chưa thể tái sử dụng cho mobile draft.
- API chưa có dynamic counts hoặc self-excluding query semantics.
- CPU/GPU chỉ là text; chưa có CPU brand, GPU brand/type hoặc panel type chuẩn hóa.
- `screenResolution` là chuỗi hiển thị, chưa có resolution tier ổn định để lọc.
- Server-side public fetch đang dùng chung cache 60 giây, không phù hợp với tồn kho và facet counts.
- Seed chỉ tạo catalog khi database rỗng; database tồn tại trước migration thông số có thể còn các cột `NULL`.

## 3. Quyết định kiến trúc

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Kiến trúc dữ liệu | Hybrid typed columns | Domain laptop ổn định, query rõ và index được mà không cần EAV |
| Facet semantics | Self-excluding | Giữ khả năng chọn OR trong cùng nhóm và cho thấy lựa chọn thay thế |
| API động | `GET /api/v1/products/facets` | Tách catalog ổn định, danh sách phân trang và aggregate state |
| API catalog | Giữ `/products/filters`, mở rộng additive | Không phá Header/Admin/client hiện có |
| Product list | Giữ response hiện tại | Pagination/sort không buộc tính lại facets trong cùng response |
| Facet aggregation | Một aggregate SQL statement cô lập | Tránh một câu `COUNT` cho mỗi option và tránh tải catalog vào Node |
| SQL safety | `Prisma.sql` với registry nội bộ và bound values | Không nối user input vào raw SQL |
| Desktop | URL update ngay | Phù hợp flow hiện tại và giữ navigation semantics |
| Mobile | Draft + debounced preview | Tránh navigation sau mỗi checkbox trên màn hình nhỏ |
| Panel data thiếu | Cho phép `NULL`, không phỏng đoán | Count phải dựa trên dữ liệu có thể chứng minh |
| Cache | Catalog cache dài; list/facets no-store hoặc TTL rất ngắn | Giá và tồn kho có thể thay đổi thường xuyên |
| Index | Chỉ thêm sau `EXPLAIN ANALYZE` | Low-cardinality index không mặc nhiên cải thiện aggregate query |

## 4. Phạm vi facet

### 4.1 Multi-select, OR trong nhóm

- `factory`: hãng sản xuất.
- `target`: nhu cầu sử dụng.
- `price`: khoảng giá rời nhau.
- `cpuBrand`: hãng CPU.
- `gpuBrand`: hãng GPU.
- `gpuType`: tích hợp hoặc rời.
- `ramGb`: dung lượng RAM chính xác.
- `storageGb`: dung lượng lưu trữ chính xác.
- `screenSize`: bucket kích thước màn hình.
- `resolutionTier`: cấp độ phân giải.
- `panelType`: loại tấm nền.

### 4.2 Single threshold

- `minRefreshHz`: tần số quét tối thiểu.
- `minBatteryWh`: dung lượng pin tối thiểu.
- `maxWeightGrams`: trọng lượng tối đa.
- `minWarrantyMonths`: thời hạn bảo hành tối thiểu.

Threshold dùng radio/select, không dùng multi-select vì các lựa chọn có tính bao hàm. Ví dụ chọn đồng thời `>=90 Hz` và `>=144 Hz` chỉ tương đương `>=90 Hz`.

### 4.3 Boolean

- `inStock=true`: chỉ sản phẩm có `quantity > 0`.
- Không gửi `inStock` nghĩa là không lọc tồn kho. `inStock=false` được normalize thành không có điều kiện; API không cung cấp chế độ "chỉ hết hàng" ở storefront.

### 4.4 Bucket boundaries

Bucket không được chồng lấn:

- Giá: `<10m`, `>=10m && <15m`, `>=15m && <=20m`, `>20m`.
- Màn hình: `<14"`, `>=14" && <16"`, `>=16"`.
- Resolution tier được lưu dưới dạng giá trị chuẩn hóa, không suy luận trong mỗi truy vấn.
- Các threshold numeric dùng `gte` hoặc `lte` đúng theo tên query.

RAM và storage là data-driven exact facets. `/products/facets` trả các giá trị thực tế đang có trong catalog cùng mọi giá trị đang được chọn, thay vì giới hạn vĩnh viễn ở 8/16/32/64 GB hoặc 256/512/1024/2048 GB. Query vẫn giới hạn số phần tử và miền số để chống lạm dụng.

## 5. Mô hình dữ liệu

Giữ các field mô tả hiện tại và bổ sung field chuẩn hóa:

```prisma
model Product {
  // Các field hiện có
  cpu              String? @db.VarChar(255)
  gpu              String? @db.VarChar(255)
  screenResolution String? @db.VarChar(50)

  cpuBrand       String? @db.VarChar(20)
  gpuBrand       String? @db.VarChar(20)
  gpuType        String? @db.VarChar(20)
  resolutionTier String? @db.VarChar(20)
  panelType      String? @db.VarChar(20)
}
```

Các giá trị ban đầu:

- CPU brand: `INTEL`, `AMD`, `APPLE`, `QUALCOMM`.
- GPU brand: `NVIDIA`, `AMD`, `INTEL`, `APPLE`, `QUALCOMM`.
- GPU type: `INTEGRATED`, `DEDICATED`.
- Resolution tier: `HD`, `FHD`, `QHD`, `UHD`.
- Panel type: `IPS`, `OLED`, `MINI_LED`, `TN`, `VA`.

Các cột dùng `String?` cộng whitelist Zod thay vì Prisma enum để phù hợp convention String status/option hiện tại và giảm chi phí migration khi taxonomy có thêm giá trị. Giá trị lạ không được lưu qua public/admin API.

### 5.1 Resolution normalization

Khi backfill hoặc ghi sản phẩm, helper chuẩn hóa chấp nhận chuỗi dạng `WIDTHxHEIGHT` hoặc `WIDTH×HEIGHT`, bỏ khoảng trắng và kiểm tra số dương. Mapping ban đầu:

- `UHD`: width `>=3840` và height `>=2160`.
- `QHD`: width `>=2560` và height `>=1440`, chưa đạt UHD.
- `FHD`: width `>=1920` và height `>=1080`, chưa đạt QHD.
- `HD`: độ phân giải hợp lệ thấp hơn FHD.

Ví dụ `1920x1200` là FHD; `2560x1600` và `2880x1800` là QHD. Chuỗi không parse được tạo unresolved audit record và để `resolutionTier = NULL`; không đoán theo tên marketing.

### 5.2 CPU/GPU normalization

Normalizer chỉ ánh xạ pattern đã kiểm chứng. Không suy ra brand/type từ một token mơ hồ:

- `Intel`, `AMD Ryzen`, `Apple M*`, `Qualcomm Snapdragon` có thể ánh xạ CPU brand.
- NVIDIA GeForce/RTX/GTX đã xác minh có thể ánh xạ `NVIDIA + DEDICATED`.
- Intel integrated graphics và Apple GPU trong catalog hiện tại có thể ánh xạ `INTEGRATED`.
- AMD Radeon hoặc model khác không đủ rõ để kết luận integrated/dedicated phải được audit thủ công.

Admin Form hiển thị select cho các field chuẩn hóa. Khi `cpu` có giá trị, `cpuBrand` phải có giá trị. Khi `gpu` có giá trị, `gpuBrand` và `gpuType` phải có giá trị. Khi `screenResolution` có giá trị hợp lệ, backend tự tính `resolutionTier`; client không được tự quyết định tier. `panelType` vẫn optional vì dữ liệu hiện tại không đủ để suy ra an toàn.

## 6. Taxonomy registry và query schema

Tạo registry backend duy nhất trong module products, ví dụ `products.facets.ts`. Registry chứa:

- facet key và nhãn tiếng Việt;
- selection mode: `MULTI`, `SINGLE_MIN`, `SINGLE_MAX`, `BOOLEAN`;
- value kind: categorical, numeric exact hoặc bucket;
- option order và label formatter;
- Zod validation;
- Prisma predicate cho product list;
- trusted SQL fragment cho aggregate engine.

Không đưa registry vào `src/config/constant.ts` nếu file đó trở thành nơi chứa logic query. `constant.ts` tiếp tục giữ option đơn giản đang được nhiều module dùng; registry facet nằm sát module products.

Schema được cấu trúc để tránh list/facet drift:

```text
productFilterFields
├── q
├── multi-select fields
├── threshold fields
└── inStock

listProductsQuery = pageQuery + productFilterFields + sort
productFacetsQuery = productFilterFields
adminListProductsQuery = listProductsQuery + isActive + stock
```

CSV parser phải:

- trim;
- bỏ phần tử rỗng;
- loại trùng nhưng giữ thứ tự đầu tiên;
- giới hạn số phần tử duy nhất của từng nhóm;
- từ chối giá trị ngoài whitelist hoặc ngoài miền số;
- không tạo SQL fragment từ key/value do client cung cấp.

`q` tiếp tục trim và giới hạn 100 ký tự. `q` không phải một facet, nên luôn được áp dụng khi tính mọi group.

## 7. Query semantics dùng chung

Tách việc dựng điều kiện khỏi orchestration:

```ts
buildProductWhere(filters, {
  admin: false,
  excludeFacet: undefined,
});
```

Quy tắc:

- Public luôn có `isActive: true`.
- Admin chỉ áp dụng `isActive` khi query yêu cầu.
- Mỗi multi-select group tạo một nhóm OR riêng; mọi nhóm được đặt trong AND.
- Exact numeric dùng `in`.
- Threshold dùng `gte`/`lte`.
- `inStock=true` dùng `quantity: { gt: 0 }`.
- `excludeFacet` chỉ bỏ predicate của group được chỉ định; `isActive` và `q` không bao giờ bị bỏ.
- Field `NULL` không match khi facet tương ứng được chọn nhưng không loại sản phẩm khi facet đó không hoạt động.

Price sort phải ổn định:

```ts
orderBy: q.sort
  ? [{ price: q.sort === "price_asc" ? "asc" : "desc" }, { id: "asc" }]
  : [{ id: "asc" }]
```

Public list, admin list và CSV export dùng cùng query builder theo chủ đích. Tests phải chứng minh việc thêm filter không làm mất `isActive`, low-stock hoặc admin semantics hiện có.

## 8. API contract

### 8.1 `GET /api/v1/products`

Route giữ response `{ data, meta }` hiện tại và nhận thêm product filter fields. Không nhúng facets để pagination/sort không bắt buộc tính aggregate.

Ví dụ:

```http
GET /api/v1/products?factory=ASUS,ACER&cpuBrand=INTEL&gpuType=DEDICATED&ramGb=16,32&screenSize=standard&minRefreshHz=144&inStock=true&page=1&pageSize=12
```

### 8.2 `GET /api/v1/products/filters`

Response cũ được giữ và mở rộng additive:

```ts
type ProductFilterCatalog = {
  factoryOptions: Option[];
  targetOptions: Option[];
  facetDefinitions: Array<{
    key: ProductFacetKey;
    name: string;
    mode: "MULTI" | "SINGLE_MIN" | "SINGLE_MAX" | "BOOLEAN";
    options?: Option[];
  }>;
};
```

`factoryOptions` và `targetOptions` vẫn tồn tại để Header, trang chủ và Admin Form không cần đổi đồng thời. Numeric exact facets có thể không có `options` tĩnh; frontend định dạng các giá trị do `/facets` trả về.

Catalog có thể cache dài vì không chứa tồn kho hoặc counts.

### 8.3 `GET /api/v1/products/facets`

Route public nhận `productFacetsQuery`; không có pagination hoặc sort trong contract.

```ts
type ProductFacetsResponse = {
  data: {
    total: number;
    groups: Partial<Record<ProductFacetKey, Array<{
      value: string;
      count: number;
    }>>>;
  };
};
```

`total` là số sản phẩm match toàn bộ filter. Mỗi `groups[key]` dùng self-excluding semantics. Static options count 0 vẫn có thể xuất hiện để UI render trạng thái disabled; RAM/storage trả các giá trị thực tế và mọi giá trị đang chọn, kể cả khi count hiện tại bằng 0.

API không trả `disabled` hoặc `selected`; đó là state trình bày mà frontend suy ra từ URL/draft.

### 8.4 Lỗi

- `400 VALIDATION_ERROR`: query ngoài whitelist, numeric ngoài miền hoặc quá nhiều giá trị.
- Lỗi database/aggregate ngoài dự kiến đi qua error middleware hiện có và trả `500` theo contract chung.
- Không dùng `AppError` cho validation Zod bình thường.
- Không log raw SQL hoặc dữ liệu query không cần thiết; dùng `lib/logger.ts` nếu bổ sung slow-query warning.

Mọi route mới hoặc thay đổi route phải cập nhật `src/docs/openapi.ts` và `tests/docs/openapi.test.ts`.

## 9. Facet engine

`product-facets.repository.ts` là boundary duy nhất được phép dùng aggregate SQL chuyên biệt. Product list tiếp tục dùng Prisma API thông thường.

Luồng aggregate:

1. Bắt đầu từ sản phẩm `isActive = true` và điều kiện `q`.
2. Tính cờ match cho từng facet group theo filter đã validate.
3. `total` đếm row thỏa tất cả cờ.
4. Khi aggregate group X, yêu cầu mọi cờ ngoài X và bỏ cờ X.
5. Categorical/exact facets dùng group aggregation; bucket/threshold facets dùng conditional sums.
6. Chuẩn hóa kết quả về `ProductFacetKey -> [{ value, count }]` theo thứ tự registry.

Toàn bộ statement được tạo từ registry cố định. Column identifier và SQL operator không đến từ request. Mọi value từ request dùng bound parameters qua `Prisma.sql`/`Prisma.join`; không dùng string interpolation với dữ liệu người dùng.

Không dùng các phương án sau:

- Một `COUNT` riêng cho từng option, vì số query tăng theo taxonomy.
- Load mọi Product vào Node để tự đếm, vì memory và latency tăng theo catalog.
- `%keyword%` trên `cpu`/`gpu` làm nguồn facet, vì count không ổn định khi nội dung mô tả thay đổi.

Facet query và list query là hai HTTP request độc lập. Một stock transaction xảy ra giữa hai request có thể tạo chênh lệch rất ngắn giữa list total và facet total; UI tự đồng bộ ở navigation/refetch tiếp theo. Không tạo distributed snapshot chỉ để loại bỏ cửa sổ eventual consistency này.

## 10. Frontend architecture

### 10.1 URL model

`ProductFilters` chứa toàn bộ multi-select, threshold, boolean, `q`, `sort` và `page`. `search-params.ts` chịu trách nhiệm duy nhất cho:

- parse URL;
- bỏ giá trị không hợp lệ;
- canonical serialization theo thứ tự key cố định;
- chuyển thành `ProductQuery` và `ProductFacetsQuery` generated types;
- đếm active filters;
- reset `page=1` khi bất kỳ filter hoặc sort thay đổi.

Các helper multi-value/scalar dùng danh sách key có type thay vì lặp logic thủ công ở nhiều hàm.

### 10.2 Component boundaries

```text
ProductsPage (Server Component)
├── DesktopFilters (router adapter)
│   └── FilterControls (controlled)
├── FilterSheet (draft owner + preview query)
│   └── FilterControls (controlled)
├── ActiveFilterChips
└── ProductGrid / EmptyState / Pagination
```

`FilterControls` nhận `filters`, `facetCounts`, `onChange`, loading state và ID prefix. Component không import router và không tự fetch.

`FilterGroup` dùng semantic fieldset cho option groups và `<details>/<summary>` cho collapse. Không thêm dependency accordion. Các control có touch target tối thiểu 44px, count có tên truy cập được và container dùng `aria-busy` khi cập nhật.

### 10.3 Desktop flow

1. Server lấy filter catalog để chuẩn hóa raw search params.
2. Server gọi product list và facets song song bằng normalized filters.
3. Desktop adapter cập nhật URL ngay khi user đổi option và reset page.
4. Trong RSC navigation, giữ state cũ, đánh dấu busy và không tạo local state song song với URL.
5. Back/Forward hoặc reload dựng lại UI từ URL.

### 10.4 Mobile flow

1. Mở sheet sao chép applied filters thành draft.
2. Chỉnh draft không thay đổi URL.
3. Sau debounce khoảng 300 ms, TanStack Query gọi `/products/facets` bằng client API same-origin.
4. Query key dùng canonical facet query; request cũ nhận abort signal khi draft đổi.
5. Footer cố định hiển thị tổng preview, hành động đặt lại và áp dụng.
6. Apply gọi `router.push()` đúng một lần rồi đóng sheet.
7. Đóng/cancel không áp dụng sẽ bỏ draft.

Khi preview thành công và `total = 0`, nút Apply hiển thị `0 sản phẩm` và bị disabled để không chủ động dẫn người dùng vào một tổ hợp chắc chắn rỗng. Nếu preview lỗi, UI hiển thị thông báo nhẹ, bỏ trạng thái disabled dựa trên count không còn tin cậy và vẫn cho phép Apply. User không bị kẹt trong sheet chỉ vì endpoint count tạm lỗi.

### 10.5 Count, chips và empty state

- Option chưa chọn: disabled khi count bằng 0.
- Option đang chọn: không disabled, kể cả count bằng 0.
- Static option hiện `Tên (count)`; RAM/storage dùng formatter đơn vị.
- Active chips hỗ trợ từng multi-value, threshold và in-stock toggle.
- Xóa chip hoặc clear-all giữ `q` và `sort` theo hành vi hiện tại, nhưng reset page.
- Empty state giữ nguyên filters và đưa ra hành động bỏ từng chip/đặt lại; không tự động sửa lựa chọn.

### 10.6 SEO

Chỉ URL chuẩn `/products` không có query string được index và dùng self-canonical. Mọi URL có `q`, facet, sort hoặc `page > 1` dùng `robots: { index: false, follow: true }` và canonical `/products` để tránh tạo vô hạn tổ hợp URL indexable. Không biến tổ hợp filter thành landing page SEO trong phạm vi này.

## 11. Cache và resource protection

- `/products/filters`: Next server fetch dùng `revalidate: 3600` vì taxonomy ổn định.
- `/products` và `/products/facets`: Next server fetch dùng `cache: "no-store"`; không dùng wrapper `revalidate: 60` chung hiện tại.
- Mobile TanStack Query có thể dùng `staleTime` 5 giây theo canonical query key để tránh refetch tức thời khi người dùng quay lại cùng một draft; đây là client cache, không thay đổi freshness của server-rendered list.
- Mobile debounce chỉ là tối ưu UX, không phải lớp bảo vệ server.
- Global rate limiter hiện có tiếp tục áp dụng endpoint public.
- Query giới hạn độ dài, số phần tử và miền numeric; SQL shape không tăng vô hạn theo input.
- Không thêm Redis facet cache ở phiên bản đầu. Chỉ cân nhắc sau khi đo traffic và latency thực tế.
- Chạy `EXPLAIN ANALYZE` với tổ hợp phổ biến và catalog đại diện. Chỉ thêm index nếu execution plan chứng minh giảm scan/cost; không thêm hàng loạt low-cardinality index theo phỏng đoán.

## 12. Audit và backfill

Tạo command riêng trong API repo, dry-run mặc định. Command dùng `config/env`, Prisma client và `lib/logger.ts`; không đọc `process.env` ngoài `src/config/env.ts` và không đọc/commit `.env`.

Mỗi sản phẩm được phân loại:

- `already_complete`;
- `safe_to_update`;
- `ambiguous`;
- `unverified_panel`;
- `invalid_resolution`.

Quy tắc:

- Chỉ cập nhật field đang `NULL`.
- Không ghi đè dữ liệu Admin đã nhập.
- Không dùng tên/ảnh làm bằng chứng duy nhất cho panel type.
- Mapping từ seed hoặc nguồn nhà sản xuất phải xác định đúng model; không tìm thấy bằng chứng thì để `NULL`.
- GPU type mơ hồ, đặc biệt AMD Radeon, phải đưa vào báo cáo thay vì đoán.
- Apply mode cần cờ rõ ràng; không tự chạy khi server boot hoặc seed chạy.

Migration được tạo và kiểm chứng với `mysql-test`; không dùng `prisma migrate reset` hoặc `db push` trên database thật. Chạy audit/backfill trên môi trường thật cần phê duyệt vận hành riêng.

## 13. Admin behavior

Admin Product Form bổ sung select cho CPU brand, GPU brand/type và panel type. Resolution tier do backend derive từ `screenResolution` và được hiển thị read-only hoặc preview để Admin phát hiện input sai.

Validation chéo:

- Có `cpu` thì phải có `cpuBrand`.
- Xóa `cpu` sẽ xóa `cpuBrand` trừ khi request patch không đụng hai field.
- Có `gpu` thì phải có `gpuBrand` và `gpuType`.
- Xóa `gpu` sẽ xóa hai field chuẩn hóa tương ứng.
- `screenResolution` hợp lệ cập nhật `resolutionTier` trong cùng service operation.
- Xóa `screenResolution` sẽ xóa `resolutionTier`.
- `panelType` độc lập và optional.

Các rule patch cần phân biệt field bị bỏ qua với field được gửi `null`; service không được vô tình xóa normalized data trong partial update không liên quan.

## 14. Error handling và degraded behavior

- Product list lỗi: dùng error boundary hiện có; không hiển thị kết quả cũ như dữ liệu mới.
- Facets lỗi nhưng product list thành công: vẫn render product list và filter controls; ẩn counts, không disable option và cung cấp retry/refresh phù hợp.
- Mobile preview lỗi: vẫn cho Apply; server-rendered destination chịu trách nhiệm hiển thị kết quả thật.
- Filter catalog lỗi: không thể parse/render filter an toàn, nên page dùng error boundary thay vì hard-code taxonomy thứ hai.
- Backfill gặp record mơ hồ: ghi vào summary, không làm cả dry-run thất bại; lỗi database hoặc schema mismatch mới làm command fail.
- Không thêm expected-error path mới ngoài validation; nếu cần lỗi nghiệp vụ mới phải dùng `AppError` với code ổn định.

## 15. Testing strategy

### 15.1 API unit/route tests

- Parse, dedupe và giới hạn CSV.
- Chấp nhận/từ chối categorical và numeric values.
- OR trong một nhóm, AND giữa nhiều nhóm.
- Price/screen bucket boundaries không chồng lấn.
- Threshold và in-stock semantics.
- `NULL` behavior.
- Public `isActive`, admin status/low-stock và export không regression.
- Stable secondary sort bằng `id`.
- `/products/filters` giữ fields cũ và thêm definitions mới.
- `/products/facets` validation và response shape.
- OpenAPI có query parameters và response schemas đúng.

### 15.2 API integration tests với MySQL

Aggregate SQL phải được kiểm chứng trên `mysql-test`, không chỉ mock Prisma:

- Self-excluding count cho multi-select.
- Count tổng khớp list query với cùng filters.
- Search `q` áp dụng cho mọi group.
- Static bucket và data-driven RAM/storage.
- Selected option count 0 vẫn có thể được trả về.
- Hidden, out-of-stock và nullable products.
- SQL parameterization với input đã validate.

Thay đổi không sửa checkout/cancel mutation, nhưng `npm run test:int` vẫn là quality gate vì facet repository dùng SQL thật và có filter tồn kho.

### 15.3 Frontend tests

- URL parse/serialize round-trip cho mọi loại filter.
- Canonical key order và page reset.
- FilterControls count/disabled behavior, gồm selected-zero.
- Desktop router adapter giữ `q`/sort và đổi đúng một group.
- Mobile open/draft/debounce/apply/cancel/reset.
- Preview error không khóa Apply.
- Active chips xóa đúng multi/scalar/toggle filter.
- Empty state giữ filters.
- Metadata noindex/canonical.

### 15.4 E2E

- Desktop chọn nhiều nhóm, URL và product result khớp.
- Chọn thêm option cùng nhóm hoạt động như OR.
- Count của nhóm đang thao tác dùng self-excluding semantics.
- Mobile draft không đổi URL trước Apply và cancel không lưu draft.
- Refresh và Back/Forward khôi phục state.
- Zero-result recovery và clear-all.
- Viewport mobile không overflow ngang; sheet footer luôn thao tác được.

## 16. Verification gates

API:

```bash
npm run lint
npm run typecheck
npm test
npm run test:int
npm run build
git diff --check
```

Web:

```bash
npm run gen:api
npm run lint
npm run lint:css
npm run typecheck
npm test
npm run build
git diff --check
```

E2E cần API và MySQL test chạy thật. `ECONNREFUSED` khi API không chạy phải được phân biệt với regression của frontend.

Không đặt timing assertion dễ flaky trong CI. Benchmark và `EXPLAIN ANALYZE` được lưu làm bằng chứng thủ công trước release; nếu latency chưa đạt yêu cầu trên dữ liệu đại diện, tối ưu query/index trước khi bật UI dynamic counts.

## 17. Rollout

1. Thêm migration nullable, taxonomy, validation và normalizer.
2. Thêm audit/backfill command và tests; chạy dry-run trên `mysql-test`/snapshot an toàn.
3. Thêm query builder, facet engine, route, OpenAPI và integration tests.
4. Generate lại web types.
5. Refactor FilterControls và triển khai desktop/mobile flows.
6. Chạy full API/web verification và E2E.
7. Deploy migration và API trước. Web cũ tiếp tục hoạt động vì cột nullable và response additive.
8. Chạy audit/backfill trên target database chỉ sau phê duyệt riêng.
9. Deploy web sau khi `/products/facets` và contract production đã sẵn sàng.
10. Theo dõi latency/error rate và đối chiếu count/list; tối ưu index nếu execution plan chỉ ra lợi ích.

Không cần feature flag riêng cho contract vì rollout backend-first tương thích ngược. Nếu dữ liệu production chưa đủ tốt, web có thể tạm ẩn riêng group panel type mà không vô hiệu hóa các facet khác.

## 18. Ngoài phạm vi

- Elasticsearch/OpenSearch, vector search hoặc search microservice.
- EAV/attribute tables hoặc JSON specifications tổng quát.
- Fuzzy search, typo correction hoặc autocomplete.
- Merchandising rules, sponsored ranking hoặc personalized facets.
- Redis facet cache.
- SEO landing pages cho từng tổ hợp filter.
- Tự crawl và ghi panel type không có kiểm duyệt.
- Tự động sửa dữ liệu production khi deploy.

## 19. Tiêu chí hoàn thành

Tính năng chỉ được coi là hoàn tất khi:

1. Mọi filter đã chốt hoạt động qua URL, API list và facet counts.
2. Counts đúng self-excluding semantics trên MySQL integration tests.
3. Option count 0/selected-zero có hành vi đúng trên desktop và mobile.
4. Mobile draft preview, Apply, Cancel và error degradation được kiểm thử.
5. OpenAPI và generated web types đồng bộ; không sửa tay `schema.d.ts`.
6. Backfill dry-run phân loại rõ dữ liệu an toàn, mơ hồ và chưa xác minh; không phỏng đoán panel type.
7. Header, Admin Product Form, admin list/export, pagination, sort và active chips không regression.
8. API/web quality gates và E2E cần thiết đều pass.
9. `EXPLAIN ANALYZE` đã được xem xét với dữ liệu đại diện; mọi index thêm vào có bằng chứng.
10. Deployment backend-first và việc chạy backfill production được ghi nhận riêng; code hoàn tất không được trình bày như bằng chứng production data đã được cập nhật.
