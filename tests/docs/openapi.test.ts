import { buildOpenApiDocument } from "docs/openapi";

const V1_PATHS = [
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/users/me",
  "/api/v1/products",
  "/api/v1/products/filters",
  "/api/v1/products/facets",
  "/api/v1/products/compare",
  "/api/v1/products/{id}",
  "/api/v1/products/{id}/reviews",
  "/api/v1/products/{id}/reviews/summary",
  "/api/v1/products/{id}/reviews/eligibility",
  "/api/v1/reviews/{id}",
  "/api/v1/reviews/helpful",
  "/api/v1/reviews/{id}/helpful",
  "/api/v1/reviews/{id}/images",
  "/api/v1/reviews/{id}/images/order",
  "/api/v1/reviews/{id}/images/{imageId}",
  "/api/v1/advisor/recommend",
  "/api/v1/cart",
  "/api/v1/cart/items",
  "/api/v1/cart/items/{id}",
  "/api/v1/orders",
  "/api/v1/orders/quote",
  "/api/v1/orders/checkout-attempt",
  "/api/v1/orders/me",
  "/api/v1/orders/me/{id}",
  "/api/v1/orders/me/{id}/payment",
  "/api/v1/orders/me/{id}/cancel",
  "/api/v1/payments/methods",
  "/api/v1/promotions/available",
  "/api/v1/webhooks/payments/{provider}",
  "/api/v1/admin/products",
  "/api/v1/admin/products/{id}",
  "/api/v1/admin/promotions",
  "/api/v1/admin/promotions/{id}",
  "/api/v1/admin/promotions/{id}/state",
  "/api/v1/admin/promotions/{id}/clone",
  "/api/v1/admin/promotions/{id}/redemptions",
  "/api/v1/admin/promotions/{id}/summary",
  "/api/v1/admin/users",
  "/api/v1/admin/users/{id}",
  "/api/v1/admin/inventory/adjustments",
  "/api/v1/admin/inventory/movements",
  "/api/v1/admin/roles",
  "/api/v1/admin/orders",
  "/api/v1/admin/orders/export.csv",
  "/api/v1/admin/products/export.csv",
  "/api/v1/admin/inventory/movements/export.csv",
  "/api/v1/admin/inventory/receipts",
  "/api/v1/admin/inventory/receipts/{id}",
  "/api/v1/admin/inventory/receipts/{id}/post",
  "/api/v1/admin/orders/{id}",
  "/api/v1/admin/orders/{id}/status",
  "/api/v1/admin/dashboard",
  "/api/v1/admin/dashboard/sales",
  "/api/v1/admin/payment-events",
  "/api/v1/admin/payment-events/{id}",
  "/api/v1/admin/payment-events/{id}/resolve",
  "/api/v1/admin/reviews",
  "/api/v1/admin/reviews/summary",
  "/api/v1/admin/reviews/{id}",
  "/api/v1/admin/reviews/{id}/moderation",
  "/api/v1/admin/reviews/{id}/reply",
];
const secured = [{ cookieAuth: [] }, { bearerAuth: [] }];

describe("openapi document", () => {
  const doc = buildOpenApiDocument();
  const op = (path: string, method: string) => (doc.paths[path] as any)[method];

  it("documents exactly the v1 routes", () => {
    expect(Object.keys(doc.paths).sort()).toEqual([...V1_PATHS].sort());
  });

  it("declares cookie and bearer auth", () => {
    expect(doc.components?.securitySchemes?.cookieAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "access_token",
    });
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({ type: "http" });
  });

  it("keeps public routes public and protects the rest", () => {
    expect(op("/api/v1/products", "get").security).toBeUndefined();
    expect(op("/api/v1/products/facets", "get").security).toBeUndefined();
    expect(op("/api/v1/auth/login", "post").security).toBeUndefined();
    expect(op("/api/v1/webhooks/payments/{provider}", "post").security).toBeUndefined();
    expect(op("/api/v1/cart", "get").security).toEqual(secured);
    expect(op("/api/v1/admin/dashboard", "get").security).toEqual(secured);
    expect(op("/api/v1/admin/dashboard", "get").responses["403"]).toBeDefined();
    expect(op("/api/v1/advisor/recommend", "post").security).toEqual([
      {},
      { cookieAuth: [] },
      { bearerAuth: [] },
    ]);
  });

  it("documents the advisor request and response contract", () => {
    const advisor = op("/api/v1/advisor/recommend", "post");
    expect(advisor.requestBody.required).toBe(true);
    expect(advisor.responses[200]).toBeDefined();
    expect(advisor.responses[400]).toBeDefined();
    expect(advisor.responses[401]).toBeDefined();
    expect(advisor.responses[429]).toBeDefined();
    expect(doc.components?.schemas).toHaveProperty("AdvisorResult");
    const properties = doc.components?.schemas?.AdvisorRequest as any;
    expect(properties.properties.workloads).toBeDefined();
    expect(properties.required ?? []).not.toContain("workloads");
  });

  it("documents the verified review paths and their security boundaries", () => {
    expect(op("/api/v1/products/{id}/reviews", "get").security).toBeUndefined();
    expect(op("/api/v1/products/{id}/reviews", "post").security).toEqual(secured);
    expect(op("/api/v1/products/{id}/reviews/eligibility", "get").security).toEqual(secured);
    expect(op("/api/v1/admin/reviews", "get").security).toEqual(secured);
    expect(op("/api/v1/admin/reviews/{id}/moderation", "patch").responses[403]).toBeDefined();
    expect(op("/api/v1/admin/reviews/{id}/reply", "put").security).toEqual(secured);
    expect(op("/api/v1/admin/reviews/{id}/reply", "delete").responses[204]).toBeDefined();
    expect(op("/api/v1/reviews/{id}/images", "post").security).toEqual(secured);
    expect(op("/api/v1/reviews/helpful", "get").security).toEqual(secured);
    expect(op("/api/v1/reviews/{id}/helpful", "put").security).toEqual(secured);
    expect(op("/api/v1/reviews/{id}/helpful", "delete").responses[200]).toBeDefined();
    expect(
      op("/api/v1/reviews/{id}/images", "post").requestBody.content["multipart/form-data"],
    ).toBeDefined();
    expect(op("/api/v1/reviews/{id}/images/order", "patch").security).toEqual(secured);
    expect(op("/api/v1/reviews/{id}/images/{imageId}", "delete").responses[204]).toBeDefined();
  });

  it("keeps the public review schema free of private and moderation fields", () => {
    const publicReview = doc.components?.schemas?.PublicReview as any;
    expect(publicReview.properties).toEqual(
      expect.not.objectContaining({
        userId: expect.anything(),
        username: expect.anything(),
        orderDetailId: expect.anything(),
        status: expect.anything(),
      }),
    );
    expect(doc.components?.schemas).toEqual(
      expect.objectContaining({
        PublicReview: expect.anything(),
        ReviewSummary: expect.anything(),
        ReviewEligibility: expect.anything(),
        OwnerReview: expect.anything(),
        AdminReviewListItem: expect.anything(),
        AdminReviewDetail: expect.anything(),
        AdminReviewSummary: expect.anything(),
        PublicOfficialReply: expect.anything(),
        AdminOfficialReply: expect.anything(),
      }),
    );
    expect((publicReview.properties as any).helpfulCount).toBeDefined();
    expect(doc.components?.schemas).toEqual(
      expect.objectContaining({
        HelpfulReviewState: expect.anything(),
        HelpfulMutation: expect.anything(),
      }),
    );
  });

  it("requires the review create fields", () => {
    const create = op("/api/v1/products/{id}/reviews", "post");
    const body = create.requestBody.content["application/json"].schema as any;
    expect(body.required).toEqual(expect.arrayContaining(["rating", "content", "isAnonymous"]));
    expect(create.responses[201]).toBeDefined();
    expect(create.responses[409]).toBeDefined();
  });

  it("documents the checkout idempotency header", () => {
    const params = op("/api/v1/orders", "post").parameters as any[];
    expect(params).toContainEqual(
      expect.objectContaining({ in: "header", name: "Idempotency-Key", required: true }),
    );
  });

  it("documents the quote and public promotion boundaries", () => {
    expect(op("/api/v1/orders/quote", "post").security).toEqual(secured);
    expect(op("/api/v1/promotions/available", "get").security).toBeUndefined();
    expect(doc.components?.schemas).toEqual(
      expect.objectContaining({
        PricingQuote: expect.anything(),
        PublicPromotion: expect.anything(),
      }),
    );
  });

  it("documents the inventory receipt and movement contract", () => {
    const adjustment = op("/api/v1/admin/inventory/adjustments", "post");
    expect(adjustment.responses[200]).toBeDefined();
    expect(adjustment.responses[201]).toBeDefined();
    expect(adjustment.parameters).toContainEqual(
      expect.objectContaining({ in: "header", name: "Idempotency-Key", required: true }),
    );
    expect(doc.components?.schemas).toHaveProperty("StockReceiptDetail");
    expect(doc.components?.schemas).toHaveProperty("StockReceiptItem");
    expect((doc.components?.schemas?.StockMovement as any).properties).toEqual(
      expect.objectContaining({
        balanceBefore: expect.anything(),
        balanceAfter: expect.anything(),
        receiptCode: expect.anything(),
      }),
    );
    expect(op("/api/v1/admin/inventory/receipts", "post").responses[409]).toBeDefined();
    expect(op("/api/v1/admin/inventory/receipts/{id}/post", "post").responses[409]).toBeDefined();
  });

  it("documents the protected promotion lifecycle contract", () => {
    expect(op("/api/v1/admin/promotions", "get").security).toEqual(secured);
    expect(op("/api/v1/admin/promotions", "post").responses[201]).toBeDefined();
    expect(op("/api/v1/admin/promotions/{id}/state", "patch").responses[409]).toBeDefined();
    expect(op("/api/v1/admin/promotions/{id}/redemptions", "get").responses[403]).toBeDefined();
    expect(doc.components?.schemas).toEqual(
      expect.objectContaining({
        PromotionSummary: expect.anything(),
        PromotionDetail: expect.anything(),
        PromotionRedemption: expect.anything(),
        PromotionStats: expect.anything(),
      }),
    );
  });

  it("documents product visibility and the admin product filters", () => {
    expect((doc.components?.schemas?.Product as any).properties).toHaveProperty("isActive");
    const names = (op("/api/v1/admin/products", "get").parameters as any[]).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["isActive", "stock"]));
  });

  it("documents rating controls and separates catalog products from base products", () => {
    const list = op("/api/v1/products", "get");
    const detail = op("/api/v1/products/{id}", "get");
    const queryNames = (list.parameters as any[]).map((parameter) => parameter.name);
    expect(queryNames).toEqual(expect.arrayContaining(["minRating", "sort"]));
    expect((doc.components?.schemas?.CatalogProduct as any).properties.reviewSummary).toBeDefined();
    expect(doc.components?.schemas).toHaveProperty("ProductReviewSummary");
    expect(list.responses[200].content["application/json"].schema.properties.data.items).toEqual(
      expect.objectContaining({ $ref: expect.stringContaining("CatalogProduct") }),
    );
    expect(detail.responses[200].content["application/json"].schema.properties.data).toEqual(
      expect.objectContaining({ $ref: expect.stringContaining("CatalogProduct") }),
    );
    expect((doc.components?.schemas?.Product as any).properties.reviewSummary).toBeUndefined();
  });

  it("documents the product hardware specs", () => {
    const props = (doc.components?.schemas?.Product as any).properties;
    for (const key of [
      "cpu",
      "cpuBrand",
      "gpu",
      "gpuBrand",
      "gpuType",
      "ramGb",
      "storageGb",
      "screenSizeInch",
      "screenResolution",
      "resolutionTier",
      "panelType",
      "refreshRateHz",
      "batteryWh",
      "weightGrams",
      "warrantyMonths",
    ]) {
      expect(props).toHaveProperty(key);
    }
  });

  it("documents the public compare endpoint", () => {
    const compare = op("/api/v1/products/compare", "get");
    expect(compare.security).toBeUndefined();
    expect((compare.parameters as any[]).map((p) => p.name)).toContain("ids");
    expect(compare.responses["404"]).toBeDefined();
  });

  it("documents the admin order search filters", () => {
    const names = (op("/api/v1/admin/orders", "get").parameters as any[]).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["status", "q", "from", "to", "userId"]));
  });

  it("documents the low-stock count on the dashboard", () => {
    expect((doc.components?.schemas?.Dashboard as any).properties).toHaveProperty("lowStockCount");
    expect(doc.components?.schemas).toHaveProperty("Payment");
    expect(doc.components?.schemas).toHaveProperty("PaymentEvent");
  });

  it("documents the order history on the admin order detail", () => {
    const detail = doc.components?.schemas?.AdminOrderDetail as any;
    expect(detail.properties).toHaveProperty("history");
    expect((doc.components?.schemas?.AdminOrder as any).properties).toHaveProperty("completedAt");
  });

  it("documents the CSV exports as text/csv", () => {
    const ok = op("/api/v1/admin/orders/export.csv", "get").responses["200"];
    expect(Object.keys(ok.content)).toEqual(["text/csv"]);
  });

  it("names the response schemas the frontend generates types from", () => {
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Error", "User", "Me", "Product", "Cart", "Order", "AdminOrder"]),
    );
  });
});
