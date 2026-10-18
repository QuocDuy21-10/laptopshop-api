import express from "express";
import request from "supertest";
import { AppError } from "lib/errors";
import { errorHandler, notFoundHandler } from "middlewares/error.middleware";

const build = () => {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", __dirname + "/../../src/views");
  app.get("/api/boom", () => {
    throw new Error("secret detail");
  });
  app.get("/api/bad", () => {
    throw new AppError("bad input", 400);
  });
  app.get("/web/boom", () => {
    throw new Error("secret detail");
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

describe("error handling", () => {
  it("returns JSON for AppError under /api", async () => {
    const res = await request(build()).get("/api/bad");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ data: null, message: "bad input" });
  });

  it("returns JSON 404 under /api", async () => {
    const res = await request(build()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.data).toBeNull();
  });

  it("returns 500 JSON for unknown errors under /api", async () => {
    const res = await request(build()).get("/api/boom");
    expect(res.status).toBe(500);
    expect(res.body.data).toBeNull();
  });

  it("renders the 500 view for web routes", async () => {
    const res = await request(build()).get("/web/boom");
    expect(res.status).toBe(500);
    expect(res.text).toContain("500 Error");
  });

  it("renders the 404 view for unknown web routes", async () => {
    const res = await request(build()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.text).toContain("<html");
  });
});
