# AI Laptop Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm một advisor public cho phép guest hoặc user nhập nhu cầu có cấu trúc, nhận tối đa ba laptop thật được ranking deterministic và nhận lời giải thích Groq có rule-based fallback.

**Architecture:** `laptopshop-api` lọc catalog MySQL, tính score `advisor-v1`, tạo evidence và giữ quyền quyết định thứ hạng; Groq chỉ diễn đạt lý do cho đúng Top 3. Redis áp request limit và AI quota, nhưng mọi lỗi AI/quota đều hạ cấp sang kết quả rule-based. `laptopshop-web` cung cấp wizard `/advisor`, gọi contract OpenAPI đã generate và tái sử dụng `ProductCard`, cart, compare.

**Tech Stack:** Express 5, TypeScript 5.7, Prisma 6/MySQL, Zod 3, Redis 5, `express-rate-limit`, Jest/Supertest; Next.js 16, React 19, TypeScript 5.9, Zod 4, React Hook Form, TanStack Query, SCSS Modules, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-ai-laptop-advisor-design.md`

## Global Constraints

- API làm trên branch `feat/ai-laptop-advisor` của `/Users/dinhduy/Workspace/nodejs/laptopshop-api`; web tạo branch cùng tên từ `develop` mới nhất của `/Users/dinhduy/Workspace/nodejs/laptopshop-web` khi bắt đầu phần web.
- Nếu execution method tạo worktree, bắt buộc dùng `superpowers:using-git-worktrees`; không chép uncommitted changes giữa checkout.
- Không đọc `.env*` (kể cả `.env.example`) khi chưa có chấp thuận riêng; không commit secret. Mọi env access chỉ nằm trong `src/config/env.ts`.
- API dùng bare aliases (`modules/*`, `lib/*`, `config/*`, `middlewares/*`, `docs/*`), `lib/logger.ts`, `AppError`, mapper; không dùng `console` và không trả Prisma row.
- Route `/api/v1` mới phải cập nhật `src/docs/openapi.ts`, `tests/docs/openapi.test.ts`, rồi generate lại `laptopshop-web/src/lib/api/schema.d.ts`.
- Advisor là public: không token thì guest; token hợp lệ thì user; có token nhưng sai/hết hạn thì `401`, không hạ xuống guest.
- Chỉ input có cấu trúc ảnh hưởng ranking. `note` tối đa 500 ký tự chỉ được dùng trong phần giải thích.
- Hard constraints: `isActive=true`, `quantity>0`, `price<=budgetMax`, và `ramGb>=minRamGb` nếu có. Không nới constraint để cố đủ Top 3.
- Groq không được thêm, xóa hoặc đảo thứ tự sản phẩm. Product/price/specs trong response phải từ database và `toProductDto`.
- `ADVISOR_AI_ENABLED` mặc định `false`; AI/quota/provider lỗi trả `200` với `mode: "rule_based"` nếu ranking thành công.
- Storefront dùng tiếng Việt, SCSS Modules, token trong `src/styles/_tokens.scss`, không literal color/inline style, touch target tối thiểu 44 px và không overflow ở 320 px.
- Không thêm migration, SDK Groq, vector database, embeddings, RAG, streaming, queue hoặc conversation storage.
- Mỗi task đi theo TDD: test fail đúng lý do → code tối thiểu → test pass → commit. Không thêm `Co-Authored-By` hoặc attribution AI; không force-push.

## Review Focus

1. Request có access cookie/Bearer sai hoặc hết hạn phải trả `401`, không được tiêu quota guest; test ở Task 3.
2. Hai request đồng thời chạm giới hạn requester/global chỉ được reserve trong giới hạn và không vượt quota; test ở Task 5.
3. CPU/GPU hoặc specs thiếu/không nhận diện không được sinh claim hiệu năng/pin; test ở Task 1 và Task 2.
4. Provider trả JSON đúng hình dạng nhưng reorder, duplicate, ID ngoài shortlist, evidence lạ hoặc số không grounded phải bị bỏ toàn bộ; test ở Task 4.
5. Catalog chỉ có 0–2 candidate, AI tắt hoặc Redis/provider lỗi vẫn phải trả đúng số kết quả deterministic, không filler; test ở Task 2 và Task 5.

## File Structure

### `laptopshop-api`

| File | Thay đổi | Trách nhiệm |
|---|---|---|
| `src/modules/advisor/advisor.schema.ts` | Create | Request enums/schema/types và public result types |
| `src/modules/advisor/advisor.hardware-profile.ts` | Create | Catalog CPU/GPU tier `advisor-v1` |
| `src/modules/advisor/advisor.ranking.ts` | Create | Normalize, weights, evidence, stable Top 3 |
| `src/modules/advisor/advisor.repository.ts` | Create | Prisma query cho hard constraints |
| `src/modules/advisor/advisor.explanation.ts` | Create | Reason/highlights/tradeoffs/suggestions deterministic |
| `src/modules/advisor/providers/advisor-provider.ts` | Create | Provider interface, input/output/error categories |
| `src/modules/advisor/providers/groq-advisor.provider.ts` | Create | Groq HTTP adapter, structured output, grounding validation |
| `src/modules/advisor/advisor.quota.ts` | Create | Quota interface và Redis fixed-window implementation |
| `src/modules/advisor/advisor.identity.ts` | Create | Guest/user requester identity, HMAC IP |
| `src/modules/advisor/advisor.service.ts` | Create | Orchestration ranking → quota/provider → fallback |
| `src/modules/advisor/advisor.controller.ts` | Create | HTTP handler |
| `src/modules/advisor/advisor.routes.ts` | Create | Optional auth, identity, limiter, validation, handler |
| `src/middlewares/authenticate.ts` | Modify | Export `optionalAuthenticate` dùng chung token extraction/verify |
| `src/middlewares/rate-limit.ts` | Modify | Advisor limiter và Redis store prefix riêng |
| `src/types/index.d.ts` | Modify | `req.advisorRequester` |
| `src/config/env.ts`, `.env.example` | Modify | Cấu hình advisor/Groq có validation |
| `src/app.ts`, `src/routes/index.ts`, `src/server.ts` | Modify | Dependency injection và production wiring |
| `src/docs/openapi.ts` | Modify | Schema/path advisor, optional auth |
| `src/config/seed-products.ts` | Create | Product seed data có thể kiểm thử |
| `src/config/seed.ts` | Modify | Dùng `productSeeds` đã sửa metadata |
| `tests/modules/advisor/*.test.ts` | Create | Ranking, explanation, service, provider, quota, route |
| `tests/middlewares/authenticate.test.ts` | Modify | Optional auth cases |
| `tests/middlewares/rate-limit.test.ts` | Modify | Advisor limiter |
| `tests/config/env.test.ts`, `tests/config/seed.test.ts` | Modify/Create | Env và catalog seed |
| `tests/docs/openapi.test.ts`, `tests/helpers/app.ts` | Modify | Contract và dependency injection |

### `laptopshop-web`

| File | Thay đổi | Trách nhiệm |
|---|---|---|
| `src/lib/api/schema.d.ts`, `src/lib/api/types.ts` | Modify | Generated advisor contract và aliases |
| `src/features/advisor/schema.ts`, `hooks.ts` | Create | Form schema và mutation typed |
| `src/features/advisor/AdvisorView/*` | Create | Điều phối form/result/error/focus |
| `src/features/advisor/AdvisorForm/*` | Create | Wizard bốn bước |
| `src/features/advisor/AdvisorResults/*` | Create | Loading, empty, mode notice, result grid |
| `src/features/advisor/AdvisorRecommendationCard/*` | Create | Explanation + existing `ProductCard` |
| `src/app/(storefront)/advisor/page.tsx` | Create | Public page metadata/shell |
| `src/components/layout/Header/Header.tsx` | Modify | Desktop advisor link |
| `src/components/layout/MobileMenu/MobileMenu.tsx` | Modify | Mobile advisor link |
| `src/app/(storefront)/page.tsx`, `page.module.scss` | Modify | Homepage CTA |
| `tests/features/advisor/*.test.tsx` | Create | Schema, hook/form/view/results |
| `tests/components/AdvisorNavigation.test.tsx` | Create | Header/mobile links |
| `e2e/storefront.spec.ts` | Modify | Advisor rule-based journey và 320 px |

## Execution Preflight

- [ ] API: xác nhận `git status --short --branch` sạch trên `feat/ai-laptop-advisor`, rồi chạy `npm run lint`, `npm run typecheck`, `npm test` làm baseline.
- [ ] Web: `git fetch origin`, fast-forward `develop`, tạo `feat/ai-laptop-advisor`, rồi chạy `npm run lint`, `npm run lint:css`, `npm run typecheck`, `npm test`, `npm run build` làm baseline.
- [ ] Nếu baseline fail, dừng và báo; không sửa lỗi ngoài phạm vi để che baseline.

---

### Task 1: Request schema, hardware profile và ranking `advisor-v1`

**Files:**
- Create: `src/modules/advisor/advisor.schema.ts`
- Create: `src/modules/advisor/advisor.hardware-profile.ts`
- Create: `src/modules/advisor/advisor.ranking.ts`
- Test: `tests/modules/advisor/advisor.schema.test.ts`
- Test: `tests/modules/advisor/advisor.ranking.test.ts`

**Interfaces:**
- Consumes: Prisma `Product` scalar fields.
- Produces: `advisorRequestSchema`, `AdvisorInput`, `AdvisorCandidate`, `AdvisorEvidence`, `RankedAdvisorCandidate`, `rankCandidates(candidates, input): RankedAdvisorCandidate[]`, `hardwareTier(kind, value): HardwareTier`.

- [ ] **Step 1: Viết failing tests cho request schema**

Tạo `advisor.schema.test.ts` với assertions:

- accept `budgetMax=20_000_000`, `usage="CODING"`, 3 priorities duy nhất, `minRamGb=16`, `workloads=["DOCKER_VM"]`, note 500 ký tự;
- reject budget `4_999_999` và `200_000_001`;
- reject 4 priorities, priority/workload trùng, `minRamGb=12`, note 501 ký tự;
- trim note và biến chuỗi rỗng thành `undefined`.

- [ ] **Step 2: Viết failing tests cho hardware/ranking**

Tạo `advisor.ranking.test.ts` để khóa:

- tier mapping CPU hiện có: `i7-12700H → high_end`, `i5-11400H/i7-1360P/M2/i5-13420H → performance`, `i5-1235U/i5-10300H/M1/i5-1135G7 → mainstream`, `i7-6500U → entry`, chuỗi lạ/null → `unknown`;
- GPU: `RTX 4050 → high_end`, `RTX 3050/RTX 2050 → performance`, `GTX 1650/Apple GPU 8 nhân → mainstream`, `GTX 950M/Iris Xe/Iris Plus/Apple GPU 7 nhân → entry`, chuỗi lạ/null → `unknown`;
- normalization đúng các ngưỡng trong spec cho RAM/storage/battery/weight/display/warranty/price fit;
- `CODING + PERFORMANCE + DOCKER_VM` tăng đúng CPU/GPU/RAM-storage rồi normalize tổng weight về 1;
- tie-break `score desc → price asc → id asc`;
- thêm candidate không liên quan không đổi score/thứ tự các candidate cũ;
- thay đổi riêng `note` không đổi score hoặc thứ tự;
- unknown specs có score 0 cho feature đó và evidence không chứa claim CPU/GPU.

- [ ] **Step 3: Chạy tests để xác nhận fail vì module chưa tồn tại**

Run:

```bash
npx jest tests/modules/advisor/advisor.schema.test.ts tests/modules/advisor/advisor.ranking.test.ts --runInBand
```

Expected: FAIL với module `modules/advisor/...` chưa tồn tại.

- [ ] **Step 4: Implement request schema và types**

Trong `advisor.schema.ts`, export `advisorRequestSchema` bằng `z.object(...).strict()` với đúng fields/enums/boundaries ở Step 1, rồi infer các type sau:

```ts
export type AdvisorInput = z.infer<typeof advisorRequestSchema>;
export type AdvisorMode = "ai_enhanced" | "rule_based";
export type AdvisorResult = {
  mode: AdvisorMode;
  recommendations: AdvisorRecommendation[];
  suggestions: string[];
};
```

Schema phải `.strict()`, uniqueness qua `.refine()`, budget `5_000_000..200_000_000`, note preprocess empty-to-undefined và max 500.

- [ ] **Step 5: Implement hardware profile**

Trong `advisor.hardware-profile.ts`, export:

```ts
export type HardwareTier = "unknown" | "entry" | "mainstream" | "performance" | "high_end";
export const HARDWARE_TIER_SCORE: Record<HardwareTier, number>;
export function hardwareTier(kind: "cpu" | "gpu", value: string | null): HardwareTier;
```

Normalize input bằng lowercase + collapse whitespace; match pattern cụ thể nhất trước. Không so sánh số model tổng quát.

- [ ] **Step 6: Implement ranking**

Trong `advisor.ranking.ts`, export `SCORING_VERSION = "advisor-v1"`, feature score helpers, weight maps/modifiers, evidence builder và:

```ts
export function rankCandidates(
  candidates: AdvisorCandidate[],
  input: AdvisorInput,
): RankedAdvisorCandidate[];
```

Hàm trả tối đa 3, chỉ round `matchScore` một lần ở cuối, giữ raw score nội bộ để sort. Evidence key dùng dạng ổn định như `ram-16gb`, `weight-1290g`, `refresh-144hz`.

- [ ] **Step 7: Chạy tests Task 1**

Run: `npx jest tests/modules/advisor/advisor.schema.test.ts tests/modules/advisor/advisor.ranking.test.ts --runInBand`

Expected: PASS toàn bộ, không snapshot.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/modules/advisor tests/modules/advisor/advisor.schema.test.ts tests/modules/advisor/advisor.ranking.test.ts
git commit -m "feat: add deterministic advisor ranking"
```

---

### Task 2: Prisma repository, rule-based explanation và service baseline

**Files:**
- Create: `src/modules/advisor/advisor.repository.ts`
- Create: `src/modules/advisor/advisor.explanation.ts`
- Create: `src/modules/advisor/providers/advisor-provider.ts`
- Create: `src/modules/advisor/advisor.service.ts`
- Test: `tests/modules/advisor/advisor.repository.test.ts`
- Test: `tests/modules/advisor/advisor.explanation.test.ts`
- Test: `tests/modules/advisor/advisor.service.test.ts`

**Interfaces:**
- Consumes: `AdvisorInput`, `RankedAdvisorCandidate`, `rankCandidates`, `toProductDto` từ Task 1/existing products mapper.
- Produces: `AdvisorRepository.findCandidates(input): Promise<AdvisorCandidate[]>`, `AdvisorProvider.explain(input): Promise<ProviderExplanation>`, `AdvisorQuota.tryReserve(requester): Promise<boolean>`, `AdvisorService.recommend(input, requester): Promise<AdvisorResult>`.

- [ ] **Step 1: Viết failing repository test**

Mock Prisma như các module hiện tại và assert `findCandidates()` gọi `prisma.product.findMany` với `isActive: true`, `quantity: { gt: 0 }`, `price: { lte: budgetMax }`, và chỉ thêm `ramGb: { gte: minRamGb }` khi có. Assert row trả về chưa bị gửi ra HTTP tại layer này.

- [ ] **Step 2: Viết failing explanation tests**

Assert rule-based explanation:

- dùng tối đa 3 deterministic highlights từ evidence;
- không nói “CPU mạnh”, “GPU phù hợp”, “pin lâu” khi field tương ứng unknown/missing;
- tạo tối đa 2 tradeoffs;
- với 0 candidate tạo suggestions tăng budget/giảm RAM; với 1–2 candidate không tạo filler.

- [ ] **Step 3: Viết failing service tests cho baseline**

Inject fake repository và assert:

- không provider/quota → `mode="rule_based"`, stable Top 3, mỗi product đã qua image mapping `/images/product/...`;
- 0, 1, 2 candidate trả đúng 0, 1, 2 recommendation;
- hard-filtered output không bị service bù bằng product khác;
- Prisma objects không được trả nguyên reference (mapper tạo DTO).

- [ ] **Step 4: Chạy tests để xác nhận fail**

Run:

```bash
npx jest tests/modules/advisor/advisor.repository.test.ts tests/modules/advisor/advisor.explanation.test.ts tests/modules/advisor/advisor.service.test.ts --runInBand
```

Expected: FAIL vì repository/explanation/service chưa tồn tại.

- [ ] **Step 5: Implement repository và fallback explanation**

`PrismaAdvisorRepository` dùng một `findMany` với hard constraints, order ban đầu `id: "asc"`, và select toàn bộ scalar fields cần để tạo Product DTO + score. `createRuleBasedRecommendation(ranked, input)` chỉ dùng evidence/specs có thật.

- [ ] **Step 6: Định nghĩa provider/quota contracts và service**

Trong `providers/advisor-provider.ts` định nghĩa:

```ts
export interface AdvisorProvider {
  explain(input: ProviderRequest): Promise<ProviderExplanation>;
}
export type AdvisorProviderFailure =
  | "timeout" | "provider_429" | "provider_5xx" | "invalid_output";
```

Trong `advisor.service.ts` export:

```ts
export type AdvisorRequester = { kind: "guest" | "user"; key: string };
export interface AdvisorQuota { tryReserve(requester: AdvisorRequester): Promise<boolean> }
export function createAdvisorService(deps: AdvisorServiceDeps): AdvisorService;
```

Ở Task này provider/quota optional; thiếu một trong hai thì service trả baseline. Không catch lỗi database từ repository.

- [ ] **Step 7: Chạy tests Task 2**

Run: `npx jest tests/modules/advisor/advisor.repository.test.ts tests/modules/advisor/advisor.explanation.test.ts tests/modules/advisor/advisor.service.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/modules/advisor tests/modules/advisor
git commit -m "feat: add rule-based advisor service"
```

---

### Task 3: Optional auth, public route, dependency injection và OpenAPI

**Files:**
- Create: `src/modules/advisor/advisor.identity.ts`
- Create: `src/modules/advisor/advisor.controller.ts`
- Create: `src/modules/advisor/advisor.routes.ts`
- Modify: `src/middlewares/authenticate.ts`
- Modify: `src/types/index.d.ts`
- Modify: `src/app.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `tests/helpers/app.ts`
- Modify: `tests/middlewares/authenticate.test.ts`
- Modify: `tests/docs/openapi.test.ts`
- Test: `tests/modules/advisor/advisor.routes.test.ts`

**Interfaces:**
- Consumes: `AdvisorService.recommend()` từ Task 2.
- Produces: `optionalAuthenticate`, `identifyAdvisorRequester(secret): RequestHandler`, `createAdvisorRoutes(deps): Router`, `POST /api/v1/advisor/recommend`, OpenAPI-generated contract.

- [ ] **Step 1: Viết failing optional-auth tests**

Trong `tests/middlewares/authenticate.test.ts`, thêm route test cho `optionalAuthenticate`:

- không cookie/header → `200`, `req.auth` undefined;
- valid cookie và valid Bearer → `req.auth` đúng user;
- invalid/expired cookie hoặc Bearer → `401 UNAUTHENTICATED`;
- cookie vẫn ưu tiên hơn Authorization giống `authenticate` hiện tại.

- [ ] **Step 2: Viết failing advisor route tests**

Cho `tests/helpers/app.ts` nhận `AppDeps` nhưng chưa implement production code. Test `POST /api/v1/advisor/recommend`:

- guest hợp lệ trả `200` và service nhận `{ kind: "guest", key: <64-char HMAC> }` không chứa raw IP;
- valid user cookie trả requester `{ kind: "user", key: "1" }`;
- invalid token trả `401` và service không được gọi;
- invalid body trả `400 VALIDATION_ERROR`;
- service result được wrap đúng `{ data: result }`.

- [ ] **Step 3: Viết failing OpenAPI tests**

Thêm `/api/v1/advisor/recommend` vào `V1_PATHS`; assert request body required, `200` có `mode/recommendations/suggestions`, `400/401/429` tồn tại, và security là optional auth (`[{}, {cookieAuth: []}, {bearerAuth: []}]`).

- [ ] **Step 4: Chạy tests để xác nhận fail**

Run:

```bash
npx jest tests/middlewares/authenticate.test.ts tests/modules/advisor/advisor.routes.test.ts tests/docs/openapi.test.ts --runInBand
```

Expected: FAIL vì middleware/route/path chưa có.

- [ ] **Step 5: Refactor auth và implement requester identity**

Trong `authenticate.ts`, tách token extraction dùng chung, giữ hành vi `authenticate` không đổi, export `optionalAuthenticate`. Trong `advisor.identity.ts`, user key là string user ID; guest key là `HMAC-SHA256(secret, "advisor-ip:" + req.ip)` hex. Gắn kết quả vào `req.advisorRequester`; cập nhật Express declaration.

- [ ] **Step 6: Implement controller/routes và app injection**

`createAdvisorRoutes` chạy theo thứ tự `optionalAuthenticate → identifyAdvisorRequester → requestLimiter → validate({ body: advisorRequestSchema }) → handler`. Ở Task này `requestLimiter` là optional và mặc định no-op; Task 5 sẽ luôn truyền advisor limiter thật từ `createApp()`. `AppDeps` nhận `advisor?: { service: AdvisorService; identitySecret: string }`; khi thiếu, `createApp()` tạo rule-based service với Prisma repository và `env.JWT_SECRET`, không Redis/provider/network.

- [ ] **Step 7: Đăng ký OpenAPI contract**

Register named schemas `AdvisorRecommendation` và `AdvisorResult`; mở rộng helper `op()` với `auth: "optional"` để tạo optional security mà không ảnh hưởng user/admin routes. Response Product dùng schema `Product` hiện có.

- [ ] **Step 8: Chạy tests Task 3**

Run: `npx jest tests/middlewares/authenticate.test.ts tests/modules/advisor/advisor.routes.test.ts tests/docs/openapi.test.ts --runInBand`

Expected: PASS; existing required-auth tests vẫn pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/middlewares/authenticate.ts src/types/index.d.ts src/modules/advisor src/app.ts src/routes/index.ts src/docs/openapi.ts tests
git commit -m "feat: expose public advisor endpoint"
```

---

### Task 4: Env validation và Groq adapter có grounded output

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Create: `src/modules/advisor/providers/groq-advisor.provider.ts`
- Modify: `src/modules/advisor/providers/advisor-provider.ts`
- Modify: `src/modules/advisor/advisor.service.ts`
- Modify: `tests/config/env.test.ts`
- Test: `tests/modules/advisor/groq-advisor.provider.test.ts`
- Modify: `tests/modules/advisor/advisor.service.test.ts`

**Interfaces:**
- Consumes: provider/evidence contracts từ Task 1–2.
- Produces: `GroqAdvisorProvider`, `GroqAdvisorConfig`, normalized `AdvisorProviderError`, AI-enriched path trong service.

- [ ] **Step 1: Viết failing env tests**

Assert defaults:

- `ADVISOR_AI_ENABLED=false`;
- `GROQ_STRUCTURED_OUTPUT_MODE="json_object"`;
- timeout `10_000`, max output `500`, limits `5/10/30`.

Assert `ADVISOR_AI_ENABLED=true` yêu cầu non-empty `GROQ_API_KEY` và `GROQ_MODEL`; reject timeout ngoài `1_000..30_000`, output ngoài `100..2_000`, quota không dương; accept modes `strict|best_effort|json_object`.

- [ ] **Step 2: Viết failing provider tests**

Inject fake `fetch` vào provider và test:

- request gửi đúng endpoint, Bearer key, model, timeout, max output và response format theo mode;
- malicious note chỉ xuất hiện trong JSON user message, không chèn vào system message;
- valid Top 3 output giữ đúng order và trả usage metadata;
- reject duplicate, missing, reordered, out-of-shortlist ID;
- reject evidence key không thuộc candidate;
- reject số trong `reason/tradeoffs` không có trong evidence/preferences;
- malformed JSON/schema/extra field → `invalid_output`;
- HTTP `429` → `provider_429`, `5xx` → `provider_5xx`, abort/timeout → `timeout`;
- không có retry: fake fetch chỉ được gọi một lần.

- [ ] **Step 3: Viết failing service enrichment tests**

Inject provider/quota fake và assert:

- quota true + valid provider → `ai_enhanced`, Product DTO/order/score/highlights giữ nguyên, chỉ reason/tradeoffs đổi;
- bất kỳ provider error/output mismatch → toàn response `rule_based`, không trộn từng item;
- provider không được gọi khi shortlist rỗng.

- [ ] **Step 4: Chạy tests để xác nhận fail**

Run:

```bash
npx jest tests/config/env.test.ts tests/modules/advisor/groq-advisor.provider.test.ts tests/modules/advisor/advisor.service.test.ts --runInBand
```

Expected: FAIL vì env/provider/enrichment chưa có.

- [ ] **Step 5: Implement env schema và `.env.example`**

Trước khi đọc/sửa `.env.example`, xin chấp thuận `.env*` theo repository rule. Sau khi được phép, thêm các key trong spec. `GROQ_API_KEY`/`GROQ_MODEL` preprocess empty-to-undefined và chỉ required trong `.superRefine()` khi AI bật. Không đặt API key mẫu có vẻ thật.

- [ ] **Step 6: Implement Groq adapter**

Constructor nhận config và `fetchImpl = fetch`. Dùng native `fetch`, `AbortSignal.timeout`, schema JSON viết tay cho structured mode và Zod `.strict()` sau parse. System prompt giới hạn vai trò ở paraphrase evidence; user message là `JSON.stringify({ preferences, note, candidates })`.

Grounding guard lấy numeric tokens từ prose, normalize `,`/`.` và chỉ chấp nhận token xuất hiện trong referenced evidence hoặc preferences. Nếu một item fail, throw `AdvisorProviderError("invalid_output")` cho cả response.

- [ ] **Step 7: Tích hợp provider path vào service**

Service chỉ gọi provider sau successful quota reservation và shortlist không rỗng. Catch quota/provider failures, log category qua dependency logger và trả baseline; không catch repository/ranking programmer errors.

- [ ] **Step 8: Chạy tests Task 4**

Run: `npx jest tests/config/env.test.ts tests/modules/advisor/groq-advisor.provider.test.ts tests/modules/advisor/advisor.service.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add .env.example src/config/env.ts src/modules/advisor tests/config/env.test.ts tests/modules/advisor
git commit -m "feat: add grounded Groq advisor provider"
```

---

### Task 5: Redis quota, advisor request limiter và production wiring

**Files:**
- Create: `src/modules/advisor/advisor.quota.ts`
- Modify: `src/middlewares/rate-limit.ts`
- Modify: `src/app.ts`
- Modify: `src/server.ts`
- Test: `tests/modules/advisor/advisor.quota.test.ts`
- Modify: `tests/modules/advisor/advisor.service.test.ts`
- Modify: `tests/middlewares/rate-limit.test.ts`

**Interfaces:**
- Consumes: `AdvisorRequester`, `AdvisorQuota`, `GroqAdvisorProvider`, env config.
- Produces: `RedisAdvisorQuota.tryReserve()`, `advisorLimiter`, fully wired production runtime.

- [ ] **Step 1: Viết failing quota tests**

Với fake Redis `eval`, assert keys/prefix/limits/TTL `86_400` truyền đúng. Fake atomic store phải test bằng `Promise.all` rằng ở boundary chỉ đúng N reservations thành công cho requester và global; user/guest dùng limit khác; reserve provider-failed không có refund API; Redis rejection propagate để service fallback.

- [ ] **Step 2: Viết failing request-limiter tests**

Trong `rate-limit.test.ts`, mount `optionalAuthenticate → identity → advisorLimiter → handler`; assert request 1–20 trả `200`, request 21 trả `429` với `{ error: { code: "RATE_LIMITED", ... } }`, và hai user IDs có counter riêng.

- [ ] **Step 3: Viết failing service quota/error tests**

Assert quota false hoặc quota throw → provider không gọi, `mode="rule_based"`; provider fail sau reserve vẫn không có lần `tryReserve` thứ hai; logger nhận category `quota` hoặc `redis_error` mà không có raw note/requester key.

- [ ] **Step 4: Chạy tests để xác nhận fail**

Run:

```bash
npx jest tests/modules/advisor/advisor.quota.test.ts tests/modules/advisor/advisor.service.test.ts tests/middlewares/rate-limit.test.ts --runInBand
```

Expected: FAIL vì Redis quota/advisor limiter chưa có.

- [ ] **Step 5: Implement atomic Redis quota**

`RedisAdvisorQuota` dùng một Lua `EVAL` cho hai keys `advisor:quota:global` và `advisor:quota:{kind}:{key}`: đọc cả hai, từ chối trước khi increment nếu một limit đã đạt; key mới `SET 1 EX 86400`, key cũ `INCR`. Không cung cấp refund method.

- [ ] **Step 6: Implement advisor limiter**

Mở rộng `createLimiters(stores)` với `stores.advisor` và `advisorLimiter`: window 15 phút, limit 20, `keyGenerator` dùng `req.advisorRequester.key`, `passOnStoreError: true`, response `RATE_LIMITED` theo error envelope chuẩn, prefix production `rl:advisor:`. Mount limiter bên trong advisor router sau identity middleware, không mount global lần hai.

- [ ] **Step 7: Wire production runtime trong `server.ts`**

Tái sử dụng Redis connection hiện có. Khi `ADVISOR_AI_ENABLED=false`, inject service không provider/quota. Khi true, tạo `RedisAdvisorQuota`, `GroqAdvisorProvider`, service và structured logger adapter. Không tạo network call ở startup.

- [ ] **Step 8: Chạy tests Task 5**

Run: `npx jest tests/modules/advisor/advisor.quota.test.ts tests/modules/advisor/advisor.service.test.ts tests/middlewares/rate-limit.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add src/modules/advisor src/middlewares/rate-limit.ts src/app.ts src/server.ts tests/modules/advisor tests/middlewares/rate-limit.test.ts
git commit -m "feat: protect advisor with Redis quotas"
```

---

### Task 6: Sửa và khóa chất lượng seed catalog

**Files:**
- Create: `src/config/seed-products.ts`
- Modify: `src/config/seed.ts`
- Test: `tests/config/seed.test.ts`

**Interfaces:**
- Consumes: Product create-many shape hiện tại.
- Produces: `productSeeds`, catalog mẫu có name/factory/target nhất quán cho ranking/demo.

- [ ] **Step 1: Viết failing seed test**

Import `productSeeds` và assert:

- tên `MacBook Air 13 M1` và `MacBook Air 13 M2` duy nhất;
- M1/M2 có target `MONG-NHE`;
- Acer Nitro và Acer Nitro V có `factory="ACER"`, `target="GAMING"`;
- mọi product có `cpu`, `gpu`, `ramGb`, `storageGb`, `weightGrams`, `batteryWh` hợp lệ;
- không có duplicate pair `(name,cpu)`.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx jest tests/config/seed.test.ts --runInBand`

Expected: FAIL vì `seed-products.ts` chưa có và metadata hiện tại sai.

- [ ] **Step 3: Extract và sửa seed data**

Chuyển mảng product khỏi `seed.ts` sang `seed-products.ts`, export `productSeeds`; `seed.ts` dùng `prisma.product.createMany({ data: productSeeds })`. Chỉ sửa bốn lỗi catalog đã duyệt, không sửa giá/stock hoặc tự động update database đang tồn tại.

- [ ] **Step 4: Chạy test Task 6 và seed-related unit suite**

Run: `npx jest tests/config/seed.test.ts tests/modules/products --runInBand`

Expected: PASS. Không chạy `npm run seed` trên database thật ở task này.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/config/seed.ts src/config/seed-products.ts tests/config/seed.test.ts
git commit -m "fix: normalize advisor seed catalog"
```

---

### Task 7: Khóa API, generate web contract và tạo mutation layer

**Files:**
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/lib/api/schema.d.ts`
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/lib/api/types.ts`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/schema.ts`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/hooks.ts`
- Test: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/tests/features/advisor/schema.test.ts`
- Test: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/tests/features/advisor/hooks.test.tsx`

**Interfaces:**
- Consumes: OpenAPI endpoint hoàn chỉnh từ Tasks 1–6.
- Produces: generated `AdvisorInput`/`AdvisorResult` aliases, `advisorFormSchema`, `AdvisorFormInput`, `useAdvisor()` mutation.

- [ ] **Step 1: Chạy full API quality gate trước khi đóng contract**

Run trong API:

```bash
npm run lint
npm run typecheck
npm test -- --runInBand
git diff --check
```

Expected: không error; mọi Jest suite PASS. Không cần `npm run test:int` vì không thay checkout/cancel/stock.

- [ ] **Step 2: Generate schema web từ OpenAPI**

Khởi động API docs theo setup local đã được người dùng cho phép (không tự đọc/copy `.env`), rồi trong web chạy `npm run gen:api`.

Expected: `schema.d.ts` có `POST /api/v1/advisor/recommend`, request/response typed; không sửa file generated bằng tay. Nếu không có môi trường API docs, dừng và xin hướng dẫn thay vì dựng schema thủ công.

- [ ] **Step 3: Viết failing schema/hook tests**

Test web schema cùng boundary/copy tiếng Việt cần cho form; hook test mock fetch và assert `POST`, JSON body đúng, response unwrap thành `data`, `429/500/network` đi qua `ApiError` hiện có.

- [ ] **Step 4: Chạy tests để xác nhận fail**

Run trong web:

```bash
npx vitest run tests/features/advisor/schema.test.ts tests/features/advisor/hooks.test.tsx
```

Expected: FAIL vì feature chưa có.

- [ ] **Step 5: Implement aliases, form schema và hook**

`src/lib/api/types.ts` lấy type trực tiếp từ generated `paths`. `advisorFormSchema` dùng Zod 4 và giữ exact enum/boundary API. `useAdvisor()` dùng `useMutation` + `unwrap(api.POST(...))`, không thêm query key/cache.

- [ ] **Step 6: Chạy tests Task 7**

Run: `npx vitest run tests/features/advisor/schema.test.ts tests/features/advisor/hooks.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit Task 7 trong repo web**

```bash
git add src/lib/api/schema.d.ts src/lib/api/types.ts src/features/advisor tests/features/advisor
git commit -m "feat: add advisor API client"
```

---

### Task 8: Wizard bốn bước

**Files:**
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorForm/AdvisorForm.tsx`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorForm/AdvisorForm.module.scss`
- Test: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/tests/features/advisor/AdvisorForm.test.tsx`

**Interfaces:**
- Consumes: `AdvisorFormInput` từ Task 7.
- Produces: `AdvisorForm({ onSubmit, pending, serverError })`, một accessible wizard độc lập để Task 9 lắp vào `AdvisorView`.

`AdvisorForm` dùng props `{ onSubmit: (input: AdvisorFormInput) => void | Promise<void>; pending: boolean; serverError?: unknown }`.

- [ ] **Step 1: Viết failing wizard tests**

Test user journey:

- bước 1 yêu cầu ngân sách + usage, không sang bước nếu invalid;
- bước 2 chọn tối đa 3 priorities, lựa chọn thứ 4 bị chặn với copy rõ ràng;
- bước 3 chọn `minRamGb` optional (`8|16|32`) và workloads optional;
- bước 4 note hiển thị hint “chỉ dùng để cá nhân hóa lời tư vấn”, max 500;
- Back giữ toàn bộ giá trị; submit đúng payload một lần; pending disable buttons;
- `serverError` map về field khi có details và không reset input.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx vitest run tests/features/advisor/AdvisorForm.test.tsx`

Expected: FAIL vì components chưa tồn tại.

- [ ] **Step 3: Implement form wizard**

Form dùng `react-hook-form` + `zodResolver`, `trigger()` theo field từng bước, semantic `fieldset/legend`, progress text “Bước N/4”, Back/Continue/Submit. Default values là budget/usage/min RAM chưa chọn, `priorities=[]`, `workloads=[]`, `note=""`; không tự áp nhu cầu người dùng. Không dùng chat bubbles hoặc inline styles.

- [ ] **Step 4: Implement server-field error application**

`AdvisorForm` nhận `serverError`, gọi `applyFieldErrors` khi backend trả `VALIDATION_ERROR`, và hiển thị form-level `Alert` cho lỗi còn lại. Không redirect guest và không reset form.

- [ ] **Step 5: Chạy tests Task 8**

Run: `npx vitest run tests/features/advisor/AdvisorForm.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Task 8 trong repo web**

```bash
git add src/features/advisor/AdvisorForm tests/features/advisor/AdvisorForm.test.tsx
git commit -m "feat: add advisor preference wizard"
```

---

### Task 9: Result states và recommendation cards tái sử dụng commerce flow

**Files:**
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/app/(storefront)/advisor/page.tsx`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorView/AdvisorView.tsx`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorView/AdvisorView.module.scss`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorResults/AdvisorResults.tsx`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorResults/AdvisorResults.module.scss`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorRecommendationCard/AdvisorRecommendationCard.tsx`
- Create: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/features/advisor/AdvisorRecommendationCard/AdvisorRecommendationCard.module.scss`
- Test: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/tests/features/advisor/AdvisorResults.test.tsx`
- Test: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/tests/features/advisor/AdvisorView.test.tsx`

**Interfaces:**
- Consumes: generated `AdvisorResult`, existing `ProductCard`/cart/compare actions.
- Produces: loading, error, empty, rule-based notice, Top 3 UI và result focus behavior.

- [ ] **Step 1: Viết failing result/card tests**

Assert:

- loading có status/skeleton và không có stale result;
- empty dùng backend suggestions + nút “Sửa tiêu chí”;
- `rule_based` hiển thị đúng notice trong spec, `ai_enhanced` không hiển thị;
- cards giữ API order, hiển thị `matchScore`, highlights, reason, tối đa 2 tradeoffs;
- card chứa existing product detail link, add-to-cart và compare button hoạt động;
- sau success focus chuyển tới heading “Laptop phù hợp với bạn” và status có `aria-live`.

- [ ] **Step 2: Chạy tests để xác nhận fail**

Run:

```bash
npx vitest run tests/features/advisor/AdvisorResults.test.tsx tests/features/advisor/AdvisorView.test.tsx
```

Expected: FAIL vì result components chưa tồn tại.

- [ ] **Step 3: Implement recommendation card**

Render explanation trong `<section>`/`<div>` rồi render `ProductCard`; không bọc `<article>` bên ngoài vì `ProductCard` đã là `<article>`. Không sao chép Price/AddToCart/CompareToggle.

- [ ] **Step 4: Implement result states và focus**

Tạo page shell có `h1`, mô tả trung thực và metadata tiếng Việt. `AdvisorResults` nhận `{ result, onEdit }`; `AdvisorView` lắp `AdvisorForm` với `useAdvisor`, giữ form mounted khi lỗi, giữ ref tới result heading và focus sau mutation success. Empty state dùng `EmptyState`, errors dùng `Alert`, loading dùng `Skeleton` hiện có.

- [ ] **Step 5: Chạy tests Task 9**

Run: `npx vitest run tests/features/advisor/AdvisorResults.test.tsx tests/features/advisor/AdvisorView.test.tsx tests/features/ProductCard.test.tsx tests/features/compare/store.test.ts`

Expected: PASS, không regression ProductCard/compare.

- [ ] **Step 6: Commit Task 9 trong repo web**

```bash
git add src/app/'(storefront)'/advisor src/features/advisor/AdvisorView src/features/advisor/AdvisorResults src/features/advisor/AdvisorRecommendationCard tests/features/advisor
git commit -m "feat: show advisor recommendations"
```

---

### Task 10: Navigation, homepage CTA và responsive storefront polish

**Files:**
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/components/layout/Header/Header.tsx`
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/components/layout/Header/Header.module.scss`
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/components/layout/MobileMenu/MobileMenu.tsx`
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/app/(storefront)/page.tsx`
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/src/app/(storefront)/page.module.scss`
- Test: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/tests/components/AdvisorNavigation.test.tsx`

**Interfaces:**
- Consumes: `/advisor` page từ Task 8–9.
- Produces: desktop/mobile/home entry points và layout 320 px–desktop.

- [ ] **Step 1: Viết failing navigation tests**

Render async `Header()` với mocked filter options và `MobileMenu`; assert desktop link, mobile link và homepage CTA đều có accessible name “Tư vấn chọn laptop” và `href="/advisor"`. Mobile click đóng dialog như target links hiện tại.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `npx vitest run tests/components/AdvisorNavigation.test.tsx`

Expected: FAIL vì links chưa có.

- [ ] **Step 3: Implement entry points**

Thêm advisor link trước dynamic target links để không biến mất khi filters API lỗi. Homepage hero giữ “Xem tất cả laptop”, thay secondary CTA bằng advisor CTA; gaming vẫn còn ở “Theo nhu cầu”.

- [ ] **Step 4: Hoàn thiện SCSS responsive**

Dùng tokens/mixins hiện có; wizard/result một cột ở mobile, grid phù hợp từ tablet, label dài wrap, mọi button/control min-height 44 px. Không thêm literal color ngoài `_tokens.scss`.

- [ ] **Step 5: Chạy tests và stylelint Task 10**

Run:

```bash
npx vitest run tests/components/AdvisorNavigation.test.tsx
npm run lint:css
```

Expected: PASS, Stylelint 0 errors.

- [ ] **Step 6: Commit Task 10 trong repo web**

```bash
git add src/components/layout src/app/'(storefront)'/page.tsx src/app/'(storefront)'/page.module.scss tests/components/AdvisorNavigation.test.tsx
git commit -m "feat: add advisor storefront entry points"
```

---

### Task 11: E2E, final verification và rollout evidence

**Files:**
- Modify: `/Users/dinhduy/Workspace/nodejs/laptopshop-web/e2e/storefront.spec.ts`
- Modify only if a verified omission is found: API/web test files owned by Tasks 1–10

**Interfaces:**
- Consumes: full API/web feature.
- Produces: browser evidence cho public flow, compare reuse, 320 px và final quality-gate evidence.

- [ ] **Step 1: Viết failing Playwright advisor journey**

Thêm test public không login: mở `/advisor`, nhập budget `40_000_000`, chọn `CODING`, min RAM `8`, một priority và một workload, submit; với seed hiện tại assert đúng 3 result cards, score/reason hiện ra; chọn hai “So sánh”, mở compare và thấy hai column headers. Không assert `ai_enhanced`; test phải pass với AI tắt.

- [ ] **Step 2: Viết failing 320 px accessibility/layout test**

Trong cùng file, set viewport `320x800`, hoàn tất hoặc duyệt wizard, assert không horizontal page overflow (`document.documentElement.scrollWidth <= window.innerWidth`), controls reachable bằng role/name và result heading focus sau submit.

- [ ] **Step 3: Chạy focused E2E với AI tắt**

Run trong web với API local đã chạy `ADVISOR_AI_ENABLED=false`:

```bash
npx playwright test e2e/storefront.spec.ts -g "advisor"
```

Expected: advisor journey và 320 px test PASS. Nếu môi trường local thiếu API/DB seed, báo `NOT VERIFIED`; không đổi test thành mock E2E.

- [ ] **Step 4: Chạy full API verification**

Run trong API:

```bash
npm run lint
npm run typecheck
npm test -- --runInBand
git diff --check
```

Expected: lint 0 errors, typecheck PASS, mọi unit/route/docs test PASS. Không chạy `test:int` vì không thay checkout/cancel/stock.

- [ ] **Step 5: Chạy full web verification**

Run trong web:

```bash
npm run lint
npm run lint:css
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: tất cả PASS.

- [ ] **Step 6: Kiểm tra contract/secret/log safety**

Run `rg -n "GROQ_API_KEY|process\.env|console\." src tests` ở API và kiểm tra thủ công: không hardcoded key, `process.env` chỉ ở `config/env.ts`/test setup hợp lệ, advisor không log note/IP/requester key. Kiểm tra `git status --short` ở cả hai repo chỉ có thay đổi dự kiến.

- [ ] **Step 7: Commit E2E**

```bash
git add e2e/storefront.spec.ts
git commit -m "test: cover advisor storefront journey"
```

- [ ] **Step 8: Optional live Groq smoke, không phải completion gate**

Chỉ khi người dùng cấp/cho phép dùng cấu hình secret: xác nhận model/structured mode/quota trên dashboard, chạy một request staging và kiểm tra `ai_enhanced`, latency, usage log. Nếu không có quyền hoặc secret, ghi rõ `NOT VERIFIED`; không đọc `.env` hoặc tạo key thay người dùng.

- [ ] **Step 9: Push cả hai feature branches và báo rollout boundaries**

Push `feat/ai-laptop-advisor` ở API và web, không force-push. Báo riêng: automated tests/build, rule-based E2E, live Groq smoke, audit database hiện hữu và production deployment; không biến một boundary thành claim cho boundary khác.
