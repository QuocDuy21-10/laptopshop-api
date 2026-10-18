import session from "express-session";
import request from "supertest";
import { mockDeep } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

jest.mock("config/client", () => ({ prisma: mockDeep<PrismaClient>() }));

import { createApp } from "../src/app";

const build = (readyChecks: Array<() => Promise<unknown>> = []) =>
  createApp({ sessionStore: new session.MemoryStore(), readyChecks });

describe("createApp", () => {
  it("GET /healthz is 200 without any dependency", async () => {
    const res = await request(build()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /readyz is 200 when all checks pass", async () => {
    const res = await request(build([async () => 1])).get("/readyz");
    expect(res.status).toBe(200);
  });

  it("GET /readyz is 503 when a check fails", async () => {
    const res = await request(build([async () => Promise.reject(new Error("db down"))])).get(
      "/readyz",
    );
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
  });

  it("sets security headers", async () => {
    const res = await request(build()).get("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("requires a token for /api routes", async () => {
    const res = await request(build()).get("/api/nope");
    expect(res.status).toBe(401);
  });

  it("renders the 404 view for unknown web routes", async () => {
    const res = await request(build()).get("/definitely-not-here");
    expect(res.status).toBe(404);
  });
});
