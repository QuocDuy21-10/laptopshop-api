import { buildOpenApiDocument } from "docs/openapi";

const V1_PATHS = [
  "/api/v1/auth/register",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/users/me",
  "/api/v1/products",
  "/api/v1/products/filters",
  "/api/v1/products/{id}",
  "/api/v1/cart",
  "/api/v1/cart/items",
  "/api/v1/cart/items/{id}",
  "/api/v1/orders",
  "/api/v1/orders/me",
  "/api/v1/orders/me/{id}",
  "/api/v1/orders/me/{id}/cancel",
  "/api/v1/admin/products",
  "/api/v1/admin/products/{id}",
  "/api/v1/admin/users",
  "/api/v1/admin/users/{id}",
  "/api/v1/admin/roles",
  "/api/v1/admin/orders",
  "/api/v1/admin/orders/{id}",
  "/api/v1/admin/orders/{id}/status",
  "/api/v1/admin/dashboard",
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
    expect(op("/api/v1/auth/login", "post").security).toBeUndefined();
    expect(op("/api/v1/cart", "get").security).toEqual(secured);
    expect(op("/api/v1/admin/dashboard", "get").security).toEqual(secured);
    expect(op("/api/v1/admin/dashboard", "get").responses["403"]).toBeDefined();
  });

  it("documents the checkout idempotency header", () => {
    const params = op("/api/v1/orders", "post").parameters as any[];
    expect(params).toContainEqual(
      expect.objectContaining({ in: "header", name: "Idempotency-Key", required: true }),
    );
  });

  it("documents product visibility and the admin product filters", () => {
    expect((doc.components?.schemas?.Product as any).properties).toHaveProperty("isActive");
    const names = (op("/api/v1/admin/products", "get").parameters as any[]).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["isActive", "stock"]));
  });

  it("documents the product hardware specs", () => {
    const props = (doc.components?.schemas?.Product as any).properties;
    for (const key of [
      "cpu",
      "gpu",
      "ramGb",
      "storageGb",
      "screenSizeInch",
      "screenResolution",
      "refreshRateHz",
      "batteryWh",
      "weightGrams",
      "warrantyMonths",
    ]) {
      expect(props).toHaveProperty(key);
    }
  });

  it("documents the admin order search filters", () => {
    const names = (op("/api/v1/admin/orders", "get").parameters as any[]).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["status", "q", "from", "to", "userId"]));
  });

  it("documents the low-stock count on the dashboard", () => {
    expect((doc.components?.schemas?.Dashboard as any).properties).toHaveProperty("lowStockCount");
  });

  it("names the response schemas the frontend generates types from", () => {
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["Error", "User", "Me", "Product", "Cart", "Order", "AdminOrder"]),
    );
  });
});
