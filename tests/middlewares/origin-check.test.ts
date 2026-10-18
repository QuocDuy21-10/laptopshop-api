import express from "express";
import request from "supertest";
import { originCheck } from "middlewares/origin-check";
import { errorHandler } from "middlewares/error.middleware";

const build = () => {
  const app = express();
  app.use("/api", originCheck(["http://localhost:3000"]));
  app.all("/api/x", (_req, res) => {
    res.sendStatus(204);
  });
  app.use(errorHandler);
  return app;
};

describe("originCheck", () => {
  it("rejects an unsafe request from a foreign origin", async () => {
    const res = await request(build()).post("/api/x").set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows an unsafe request from an allowed origin", async () => {
    const res = await request(build()).post("/api/x").set("Origin", "http://localhost:3000");
    expect(res.status).toBe(204);
  });

  it("allows requests without an Origin header", async () => {
    expect((await request(build()).delete("/api/x")).status).toBe(204);
  });

  it("ignores the Origin on safe methods", async () => {
    const res = await request(build()).get("/api/x").set("Origin", "https://evil.example");
    expect(res.status).toBe(204);
  });
});
