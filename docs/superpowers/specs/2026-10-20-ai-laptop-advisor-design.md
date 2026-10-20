# AI Laptop Advisor: thiết kế

Ngày: 2026-10-20
Branch: `feat/ai-laptop-advisor` (cắt từ `develop`)
Nguồn: `docs-local/plan/ai-laptop-advisor.md`

## 1. Mục tiêu

Xây dựng một trợ lý chọn laptop public cho storefront. Người dùng nhập ngân sách, nhu cầu và các ưu tiên có cấu trúc; hệ thống trả tối đa ba laptop đang bán, còn hàng và phù hợp nhất, kèm lý do và điểm đánh đổi bằng tiếng Việt.

Tính năng phải đạt các mục tiêu sau:

1. Chỉ giới thiệu sản phẩm có thật trong MySQL; không để LLM tạo tên máy, giá, tồn kho hoặc thông số.
2. Cùng một input và catalog phải luôn tạo cùng thứ hạng.
3. Khi Groq bị tắt, hết quota, timeout hoặc trả output sai, người dùng vẫn nhận recommendation từ ranking engine.
4. Guest dùng được tính năng; người đã đăng nhập được nhận diện riêng để áp quota.
5. Tận dụng Product DTO, cart và compare hiện có của hai repository.
6. Giữ MVP đơn giản: một request đồng bộ, không streaming, queue, conversation storage, embeddings, vector database, RAG hoặc AI microservice.

Repo `laptopshop-api` chịu trách nhiệm lọc, xếp hạng, quota, gọi provider, kiểm tra output và trả contract OpenAPI. Repo `laptopshop-web` chịu trách nhiệm wizard, trạng thái UI và tái sử dụng các hành động mua/so sánh hiện có.

## 2. Quyết định đã chốt

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Kiến trúc | Hybrid đồng bộ | Ranking deterministic quyết định sản phẩm; LLM chỉ giải thích |
| Phạm vi truy cập | Public cho guest, nhận diện user nếu đã đăng nhập | Advisor phục vụ giai đoạn khám phá trước khi mua |
| Input ảnh hưởng ranking | Chỉ dữ liệu có cấu trúc | Fallback phải cho cùng kết quả với chế độ AI |
| Văn bản tự do | Chỉ cá nhân hóa lời giải thích | Không để provider thay đổi nghiệp vụ ranking |
| Provider MVP | Groq | Một provider thực tế, ít nhánh cấu hình và kiểm thử |
| Khả năng thay provider | Interface `AdvisorProvider` | Có thể thêm Gemini mà không đổi service hoặc API |
| Kết quả khi AI lỗi | `200`, `mode: "rule_based"` | Recommendation cơ bản luôn hoạt động |
| Số kết quả | Tối đa Top 3 | Đủ để quyết định và tương thích luồng compare 2–4 sản phẩm |
| API transport | Request/response JSON thông thường | MVP không cần SSE hoặc WebSocket |
| Dữ liệu hiệu năng | Catalog CPU/GPU có version trong code | Không thêm cột điểm chủ quan vào Product/admin ở MVP |
| Public contract | enum `ai_enhanced`, `rule_based` | Không làm lộ provider như một phần contract ổn định |

## 3. Kiến trúc backend

Thêm module `src/modules/advisor/`:

```text
advisor.routes.ts
advisor.controller.ts
advisor.schema.ts
advisor.service.ts
advisor.repository.ts
advisor.ranking.ts
advisor.hardware-profile.ts
advisor.explanation.ts
advisor.quota.ts
providers/
  advisor-provider.ts
  groq-advisor.provider.ts
```

Ranh giới trách nhiệm:

- `advisor.repository.ts`: truy vấn các Product đang bán và còn hàng, chỉ select trường cần thiết.
- `advisor.hardware-profile.ts`: nhận diện CPU/GPU đã biết, trả tier có version hoặc `unknown`.
- `advisor.ranking.ts`: pure functions để normalize, điều chỉnh trọng số, tính điểm và sắp xếp. File này không biết Express, Prisma, Redis hoặc Groq.
- `advisor.explanation.ts`: tạo `highlights`, `reason`, `tradeoffs` và `suggestions` deterministic cho fallback.
- `advisor-provider.ts`: contract độc lập provider; chỉ nhận Top 3 cố định và trả phần giải thích theo `productId`.
- `groq-advisor.provider.ts`: gọi HTTP, timeout, parse, Zod-validate và chuẩn hóa lỗi provider.
- `advisor.quota.ts`: abstraction quota cùng Redis implementation; unit test dùng in-memory fake.
- `advisor.service.ts`: điều phối repository → ranking → quota → provider/fallback → Product DTO.
- Controller/routes: chỉ xử lý HTTP, validation và requester identity.

Không tạo Redis singleton hoặc đọc `process.env` trong module. `server.ts` tạo Redis quota và Groq provider rồi inject một advisor runtime vào `createApp()`. Khi `createApp()` không nhận provider/quota production, advisor mặc định chạy `rule_based`; vì vậy Jest không cần database thật, Redis hoặc network.

## 4. API contract

### 4.1 Route

```http
POST /api/v1/advisor/recommend
Content-Type: application/json
```

Route là public và chạy optional authentication trước request limiter:

- Không có access token: guest.
- Token hợp lệ: identity là `user:{req.auth.id}`.
- Có token nhưng token sai/hết hạn: trả `401`; không hạ xuống guest.
- Guest identity là HMAC của `req.ip`, không lưu IP thô trong Redis hoặc log.

Optional authentication phải tái sử dụng logic verify token hiện có. Không thêm cơ chế đọc JWT thứ hai.

### 4.2 Request

```ts
type AdvisorRequest = {
  budgetMax: number;
  usage: "CODING" | "GAMING" | "OFFICE" | "CREATIVE";
  priorities: Array<
    "PERFORMANCE" | "PORTABILITY" | "BATTERY" | "DISPLAY" | "VALUE"
  >;
  minRamGb?: 8 | 16 | 32;
  workloads?: Array<
    "DOCKER_VM" | "ESPORTS" | "AAA_GAMING" | "PHOTO_VIDEO" | "CAD_3D"
  >;
  note?: string;
};
```

Validation:

- `budgetMax`: số nguyên từ `5_000_000` đến `200_000_000` VND.
- `priorities`: tối đa 3 phần tử, không trùng.
- `workloads`: không trùng.
- `note`: trim, tối đa 500 ký tự; không ảnh hưởng filter hoặc score.
- Zod output của request được đọc từ `req.body`, theo pattern `validate({ body })` hiện tại; query và params mới dùng `res.locals`.

### 4.3 Response

```ts
type AdvisorResponse = {
  data: {
    mode: "ai_enhanced" | "rule_based";
    recommendations: Array<{
      product: ProductDto;
      matchScore: number;
      highlights: string[];
      reason: string;
      tradeoffs: string[];
    }>;
    suggestions: string[];
  };
};
```

Quy tắc:

- `ProductDto` luôn đi qua `toProductDto`; không trả Prisma row.
- `matchScore` là số nguyên `0–100`.
- `highlights` do ranking/fallback tạo từ dữ liệu có cấu trúc, không do LLM quyết định.
- `suggestions` chỉ dùng khi có ít hoặc không có kết quả, ví dụ đề nghị tăng ngân sách hoặc giảm RAM tối thiểu.
- Không tự vượt hard constraint để cố đủ ba sản phẩm.
- Response không công bố tên provider/model.

### 4.4 Lỗi

- `400`: request không hợp lệ.
- `401`: request mang token không hợp lệ/hết hạn.
- `429`: vượt request rate limit chống spam.
- Lỗi quota AI, Redis quota, provider, timeout hoặc output AI không hợp lệ không trở thành lỗi HTTP nếu ranking đã thành công; trả `200` với `mode: "rule_based"`.
- Lỗi database hoặc lỗi nội bộ ngoài provider tiếp tục đi qua `AppError`/error middleware hiện tại.

## 5. Candidate filtering và ranking

### 5.1 Hard constraints

Repository chỉ lấy sản phẩm:

- `isActive: true`;
- `quantity > 0`;
- `price <= budgetMax`;
- `ramGb >= minRamGb` khi request có `minRamGb`.

`budgetMax`, `minRamGb`, trạng thái bán và tồn kho là hard constraints. Priorities và workloads là soft preferences.

Nếu không có kết quả, service trả `recommendations: []`, `mode: "rule_based"` và suggestions deterministic. Nếu chỉ có một hoặc hai kết quả, trả đúng số đó.

### 5.2 Scoring version 1

Tiêu chí nội bộ:

- CPU;
- GPU;
- RAM/storage;
- pin;
- tính di động (trọng lượng);
- màn hình (độ phân giải và tần số quét);
- giá trị (khoảng cách với ngân sách và bảo hành).

Trọng số nền, theo phần trăm:

| Usage | CPU | GPU | RAM/storage | Pin | Di động | Màn hình | Giá trị |
|---|---:|---:|---:|---:|---:|---:|---:|
| `CODING` | 25 | 5 | 25 | 10 | 10 | 10 | 15 |
| `GAMING` | 20 | 30 | 15 | 5 | 5 | 15 | 10 |
| `OFFICE` | 15 | 0 | 20 | 20 | 15 | 10 | 20 |
| `CREATIVE` | 20 | 25 | 20 | 5 | 5 | 20 | 5 |

Priority modifiers được cộng trước khi normalize lại tổng trọng số:

- `PERFORMANCE`: +5 CPU, +5 GPU.
- `PORTABILITY`: +10 di động.
- `BATTERY`: +10 pin.
- `DISPLAY`: +10 màn hình.
- `VALUE`: +10 giá trị.

Workload modifiers:

- `DOCKER_VM`: +5 CPU, +10 RAM/storage.
- `ESPORTS`: +10 GPU, +5 màn hình.
- `AAA_GAMING`: +15 GPU.
- `PHOTO_VIDEO`: +7 CPU, +8 RAM/storage, +10 màn hình.
- `CAD_3D`: +10 CPU, +15 GPU.

Sau modifiers, trọng số được normalize về tổng 1. Mỗi feature score nằm trong `0–1`; tổng được đổi thành `0–100` và làm tròn một lần ở cuối. Version đầu có ID `advisor-v1`.

Normalization dùng các ngưỡng cố định, không dùng min/max của tập candidate. Vì vậy thêm hoặc xóa một sản phẩm không liên quan sẽ không làm thay đổi điểm của sản phẩm khác:

- CPU/GPU tier: `unknown = 0`, `entry = 0.25`, `mainstream = 0.5`, `performance = 0.75`, `high_end = 1`.
- RAM: `<8 GB = 0.2`, `8 GB = 0.4`, `16 GB = 0.75`, `>=32 GB = 1`.
- Storage: `<256 GB = 0.2`, `256 GB = 0.35`, `512 GB = 0.7`, `>=1024 GB = 1`.
- RAM/storage là trung bình cộng của hai thành phần trên.
- Battery: `<=40 Wh = 0.2`, `41–50 Wh = 0.5`, `51–65 Wh = 0.75`, `>65 Wh = 1`.
- Di động: `<=1200 g = 1`, `1201–1500 g = 0.85`, `1501–1800 g = 0.65`, `1801–2200 g = 0.4`, `>2200 g = 0.2`.
- Resolution: dưới Full HD `0.2`, Full HD `0.6`, trên Full HD `0.9`; refresh rate `<=60 Hz = 0.4`, `61–119 Hz = 0.65`, `>=120 Hz = 1`. Điểm màn hình là trung bình hai thành phần; screen size chỉ hiển thị, không mặc định coi lớn hơn là tốt hơn.
- Warranty: `min(warrantyMonths / 36, 1)`.
- Price fit: `clamp((budgetMax - price) / budgetMax, 0, 1)`.
- Giá trị: `70% priceFit + 30% warranty`; không dùng `sold` để tránh popularity bias ở MVP.

CPU/GPU được nhận diện bằng catalog model/pattern đã kiểm chứng trong `advisor.hardware-profile.ts`. Catalog map model vào một trong năm tier trên; không suy diễn hiệu năng bằng cách so sánh số model. Giá trị không nhận diện được là `unknown` và không được dùng để tạo khẳng định hiệu năng. Mọi field số bị thiếu có score `0`; việc thiếu dữ liệu làm giảm riêng feature score tương ứng, không loại sản phẩm nếu trường đó không phải hard constraint.

Thứ tự cuối:

1. `matchScore desc`;
2. `price asc`;
3. `id asc`.

Chọn tối đa ba sản phẩm đầu. Provider không có quyền đổi thứ tự này.

## 6. Giải thích rule-based

`advisor.explanation.ts` tạo nội dung tiếng Việt từ các feature đã biết:

- `highlights`: 2–3 điểm mạnh có dữ liệu trực tiếp, ví dụ RAM 16 GB, trọng lượng 1.29 kg hoặc màn hình 144 Hz.
- `reason`: một câu ghép từ usage, workloads và các điểm mạnh nhất.
- `tradeoffs`: tối đa hai điểm yếu hoặc dữ liệu thiếu có liên quan đến nhu cầu.
- `suggestions`: hướng điều chỉnh hard constraint khi không đủ kết quả.

Template không được nói "pin lâu", "CPU mạnh" hoặc "GPU phù hợp" nếu feature tương ứng là `unknown`. Đây vừa là fallback khi Groq lỗi, vừa là baseline để so sánh chất lượng AI.

## 7. Groq provider

Provider chỉ nhận:

- request preferences đã validate;
- `note` dưới dạng dữ liệu người dùng không đáng tin, tách khỏi system instruction;
- đúng Top 3 gồm `id`, `name`, `price` và các specs có cấu trúc cần để giải thích.

Không gửi `detailDesc`, IP, user ID, thông tin tài khoản, cart hoặc order.

Provider output:

```ts
type ProviderExplanation = {
  recommendations: Array<{
    productId: number;
    reason: string;
    evidenceKeys: string[];
    tradeoffs: string[];
  }>;
};
```

Backend phải kiểm tra:

1. JSON parse thành công và qua Zod schema.
2. Mọi `productId` nằm trong Top 3.
3. Không trùng, không thiếu và đúng thứ tự ranking.
4. `reason` dài 1–300 ký tự; có tối đa hai tradeoff, mỗi phần tử dài 1–180 ký tự.
5. Mọi `evidenceKey` thuộc danh sách fact do backend tạo cho đúng sản phẩm.
6. Mọi giá trị số xuất hiện trong prose phải có trong evidence được tham chiếu hoặc trong preferences của người dùng.
7. Không có extra fields ngoài schema.

Mỗi candidate được gửi kèm danh sách evidence có ID do backend tạo, ví dụ `ram-16gb`, `weight-1290g`, `refresh-144hz`. Cách này cho phép backend kiểm tra lời giải thích có bám vào fact đã biết thay vì chỉ kiểm tra hình dạng JSON. Nếu một điều kiện sai, bỏ toàn bộ provider output và dùng rule-based cho cả response. Không trộn output hợp lệ/không hợp lệ và không retry tự động trong cùng request.

Node dùng `fetch` và `AbortSignal.timeout`; chưa thêm Groq SDK. `GROQ_STRUCTURED_OUTPUT_MODE` chọn `strict`, `best_effort` hoặc `json_object` theo capability của model đã kiểm tra khi deploy. Bất kể mode, output vẫn phải qua Zod.

## 8. Cấu hình, quota và logging

Mọi biến được khai báo và validate trong `src/config/env.ts`:

```text
ADVISOR_AI_ENABLED
GROQ_API_KEY
GROQ_MODEL
GROQ_STRUCTURED_OUTPUT_MODE
ADVISOR_AI_TIMEOUT_MS
ADVISOR_AI_MAX_OUTPUT_TOKENS
ADVISOR_GUEST_DAILY_LIMIT
ADVISOR_USER_DAILY_LIMIT
ADVISOR_GLOBAL_DAILY_LIMIT
```

`GROQ_API_KEY` chỉ bắt buộc khi `ADVISOR_AI_ENABLED=true`. Không đưa key vào frontend hoặc biến `NEXT_PUBLIC_*`.

Hai lớp bảo vệ:

1. Request limiter riêng cho endpoint, mặc định 20 request/15 phút theo requester identity.
2. AI quota theo guest/user và global, mặc định guest 5/ngày, user 10/ngày, global 30/ngày.

Redis dùng key prefix riêng. Bộ đếm requester và global dùng fixed window 24 giờ tính từ lần reserve đầu tiên, được reserve nguyên tử trước khi gọi provider và có TTL. Một lần reserve vẫn được tính khi provider lỗi; không hoàn quota vì mục đích của giới hạn là bảo vệ số lần gọi upstream. Nếu không reserve được quota, service đi thẳng tới fallback. Provider `429` không được retry trong request. Request limiter đặt `passOnStoreError: true`; khi Redis store lỗi, request vẫn đi tiếp nhưng AI quota thất bại sẽ buộc service dùng rule-based. Các giá trị nội bộ là giới hạn bảo vệ ứng dụng, không được xem là quota chính thức của Groq; deployment phải kiểm tra dashboard provider.

Không log raw `note`, IP, token, cookie hoặc API key. Structured log qua `lib/logger.ts` gồm request ID, mode, model, latency, token usage nếu có, candidate count và failure category chuẩn hóa (`disabled`, `quota`, `timeout`, `provider_429`, `provider_5xx`, `invalid_output`, `redis_error`).

## 9. Dependency injection và route registration

`server.ts` dùng Redis client đang có để tạo advisor limiter/quota và tạo Groq provider từ `env`. `AppDeps` nhận advisor runtime; `createApiV1Router()` chuyển runtime vào `createAdvisorRoutes()`.

Route factory dùng contract sau:

```ts
createAdvisorRoutes({
  service,
  requestLimiter,
  identifyRequester,
});
```

Điều này giữ `createApp()` không có side effect và cho phép route tests inject fake provider/quota. Không để controller tự tạo provider hoặc Redis connection.

Route mới phải được khai báo trong `src/docs/openapi.ts`, kèm schema request/response và lỗi `400`, `401`, `429`. `tests/docs/openapi.test.ts` khóa contract. Sau khi API document thay đổi, repo web chạy `npm run gen:api` và commit `src/lib/api/schema.d.ts`.

## 10. Frontend

### 10.1 Trang và luồng

Thêm trang public `/advisor`, dùng wizard ngắn thay vì giao diện chat giả:

1. Ngân sách và mục đích sử dụng.
2. Tối đa ba ưu tiên.
3. Các workload cụ thể.
4. Ghi chú không bắt buộc, có copy nói rõ chỉ dùng để cá nhân hóa lời giải thích.

Submit dùng TanStack Query `useMutation`. Form không bị xóa khi network error; submit được khóa khi request đang chạy.

### 10.2 Cấu trúc

```text
src/app/(storefront)/advisor/page.tsx
src/features/advisor/AdvisorView/
src/features/advisor/AdvisorForm/
src/features/advisor/AdvisorResults/
src/features/advisor/AdvisorRecommendationCard/
src/features/advisor/schema.ts
src/features/advisor/hooks.ts
```

`AdvisorRecommendationCard` bao quanh `ProductCard` hiện có để tái sử dụng Product DTO, price, stock badge, add-to-cart và compare. Không sao chép các luồng cart/compare.

### 10.3 Trạng thái UI

- Loading skeleton và chặn submit lặp.
- Validation message gắn đúng field.
- Network error có nút thử lại và giữ nguyên input.
- Empty state hiển thị backend `suggestions` và nút sửa tiêu chí.
- `rule_based` hiển thị thông báo nhẹ: "Đề xuất đang được tạo từ tiêu chí và thông số sản phẩm; phần giải thích AI tạm thời không khả dụng."
- Sau thành công, chuyển focus tới heading kết quả; trạng thái request dùng `aria-live`.

Thêm link "Tư vấn chọn laptop" vào desktop header, mobile menu và một CTA nhỏ trên homepage. UI tuân thủ `DESIGN.md`, SCSS Modules, copy tiếng Việt, touch target tối thiểu 44 px và không overflow ở viewport 320 px.

## 11. Chất lượng dữ liệu catalog

Ranking không dùng `target` làm nguồn sự thật vì dữ liệu hiện có không đủ tin cậy. Trước khi bật advisor cần sửa seed ít nhất các lỗi đã xác nhận:

- MacBook Air M1 không để `target: "GAMING"`.
- Acer Nitro không để target sinh viên/văn phòng khi cấu hình và mô tả là gaming.
- Acer Nitro V không để `factory: "ASUS"` hoặc target mỏng nhẹ.
- Hai sản phẩm `MacBook Air 13` cần tên phân biệt thế hệ M1/M2.

Sửa `src/config/seed.ts` chỉ ảnh hưởng database rỗng. Không tạo migration SQL tự động theo tên sản phẩm vì tên đang trùng và dữ liệu thật có thể đã được admin sửa. Database đang chạy phải được audit rồi sửa qua luồng admin có kiểm soát trước khi bật AI.

## 12. Kiểm thử

### 12.1 API

- `advisor.schema.test.ts`: boundary ngân sách, enum, duplicate priorities/workloads, độ dài note.
- `advisor.ranking.test.ts`: hard constraints, từng usage/workload, unknown CPU/GPU, priority modifiers, tie-break ổn định và invariance khi thêm candidate không liên quan.
- `advisor.explanation.test.ts`: fallback không khẳng định specs bị thiếu.
- `groq-advisor.provider.test.ts`: success, malformed JSON, schema mismatch, ID lạ, timeout, `429`, `5xx` và usage metadata.
- `advisor.service.test.ts`: AI success; từng fallback category; hydrate Product DTO; provider không đổi thứ hạng.
- `advisor.routes.test.ts`: guest, user hợp lệ, token sai, validation, empty result và request limiter.
- `advisor.quota.test.ts`: requester/global reservation, TTL và boundary limits qua abstraction/fake; Redis implementation giữ thao tác reserve nguyên tử.
- `tests/docs/openapi.test.ts`: path và schema mới.
- `tests/config/env.test.ts`: key bắt buộc có điều kiện và defaults.

Không cần `npm run test:int`, vì feature chỉ đọc tồn kho và không thay đổi checkout, cancel hoặc stock.

### 12.2 Frontend

- Validation/payload của wizard.
- Loading, empty, network error, `ai_enhanced`, `rule_based`.
- Recommendation card giữ cart và compare actions.
- Keyboard/focus, navigation link và copy tiếng Việt.
- Playwright E2E dùng backend với AI tắt để kết quả deterministic.
- Live Groq chỉ là smoke test thủ công, không chạy trong CI và không commit secret.

### 12.3 Quality gates

API:

```bash
npm run lint
npm run typecheck
npm test
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

## 13. Rollout

1. Sửa seed và audit catalog đang tồn tại.
2. Deploy backend với `ADVISOR_AI_ENABLED=false`; xác minh toàn bộ rule-based flow.
3. Deploy frontend advisor.
4. Bật Groq ở staging với quota nội bộ thấp.
5. Chạy một tập tình huống tiếng Việt cố định để so sánh lời giải thích AI với baseline rule-based.
6. Xác nhận model, structured output mode và quota thật trên Groq dashboard.
7. Bật production; theo dõi latency, fallback ratio, token usage và failure category.
8. Khi có sự cố, đặt `ADVISOR_AI_ENABLED=false`; advisor tiếp tục hoạt động mà không rollback code.

## 14. Tiêu chí hoàn thành

- Cùng input và catalog luôn cho cùng thứ hạng.
- Chỉ sản phẩm active, còn hàng và đạt hard constraints xuất hiện trong kết quả.
- LLM không thể thêm, xóa hoặc đảo thứ tự sản phẩm.
- Mọi output provider đều được validate và hydrate từ backend.
- AI/provider/Redis quota lỗi đều hạ cấp an toàn sang `rule_based`.
- Guest và user có quota identity tách biệt; không lưu raw IP.
- OpenAPI và frontend generated types khớp nhau.
- Trang advisor hoạt động ở 320 px, keyboard và screen-reader state cơ bản.
- Hai repo qua toàn bộ quality gates nêu trên.

## 15. Ngoài phạm vi MVP

- Gemini/OpenRouter fallback thứ hai.
- Multi-turn chat và lưu lịch sử hội thoại.
- Streaming SSE/WebSocket.
- RAG, embeddings, vector database hoặc fine-tuning.
- Semantic search trên mô tả sản phẩm.
- Admin dashboard cho token/cost analytics.
- Cache recommendation theo input.
- Cá nhân hóa từ lịch sử mua hàng hoặc profile người dùng.
- Tự động benchmark CPU/GPU từ nguồn bên ngoài.
