import session from "express-session";
import request from "supertest";

jest.mock("config/client", () => ({ prisma: { user: { findUnique: jest.fn() } } }));

// env is parsed at import time, so load a fresh app per ENABLE_DOCS value
const buildApp = (enableDocs: "true" | "false") => {
  process.env.ENABLE_DOCS = enableDocs;
  let app!: import("express").Express;
  jest.isolateModules(() => {
    const { createApp } = require("../../src/app");
    const { registerDocs } = require("docs/openapi");
    app = createApp({ sessionStore: new session.MemoryStore(), registerExtras: registerDocs });
  });
  delete process.env.ENABLE_DOCS;
  return app;
};

describe("docs routes", () => {
  it("serves the spec without a token when ENABLE_DOCS=true", async () => {
    const res = await request(buildApp("true")).get("/api-docs.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
  });

  it("serves the UI when ENABLE_DOCS=true", async () => {
    const res = await request(buildApp("true")).get("/api-docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger");
  });

  it("is not mounted when ENABLE_DOCS=false", async () => {
    const res = await request(buildApp("false")).get("/api-docs.json");
    expect(res.status).toBe(404);
  });
});
