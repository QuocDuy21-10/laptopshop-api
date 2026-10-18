import request from "supertest";
import { mockDeep } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

jest.mock("config/client", () => ({ prisma: mockDeep<PrismaClient>() }));

import { createApp } from "../src/app";

const build = (readyChecks: Array<() => Promise<unknown>> = []) => createApp({ readyChecks });

describe("createApp", () => {
  it("GET /healthz is 200 without any dependency", async () => {
    const res = await request(build()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /readyz is 200 when all checks pass", async () => {
    expect((await request(build([async () => 1])).get("/readyz")).status).toBe(200);
  });

  it("GET /readyz is 503 when a check fails", async () => {
    const res = await request(build([async () => Promise.reject(new Error("db down"))])).get(
      "/readyz",
    );
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
  });

  it("sets locked-down security headers for a JSON API", async () => {
    const res = await request(build()).get("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("protects /api/v1/cart", async () => {
    expect((await request(build()).get("/api/v1/cart")).status).toBe(401);
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(build()).get("/definitely-not-here");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("no longer serves the legacy pages", async () => {
    expect((await request(build()).get("/login")).status).toBe(404);
    expect((await request(build()).post("/api/login")).status).toBe(404);
  });
});
