import { buildOpenApiDocument } from "docs/openapi";

describe("openapi document", () => {
  const doc = buildOpenApiDocument();

  it("documents the existing /api routes", () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/api/login",
        "/api/account",
        "/api/users",
        "/api/users/{id}",
        "/api/add-product-to-cart",
      ]),
    );
  });

  it("declares bearer auth and protects /api/account", () => {
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect((doc.paths["/api/account"] as any).get.security).toEqual([{ bearerAuth: [] }]);
  });

  it("login is public", () => {
    expect((doc.paths["/api/login"] as any).post.security).toBeUndefined();
  });
});
