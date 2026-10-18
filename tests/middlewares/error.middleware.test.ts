import express from "express";
import request from "supertest";
import { z } from "zod";
import { AppError } from "lib/errors";
import { errorHandler, notFoundHandler } from "middlewares/error.middleware";

const build = () => {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", __dirname + "/../../src/views");
  app.use(express.json());
  app.get("/api/boom", () => {
    throw new Error("secret detail");
  });
  app.get("/api/bad", () => {
    throw new AppError("bad input", 400);
  });
  app.get("/api/conflict", () => {
    throw new AppError("no stock", 409, "OUT_OF_STOCK", { productId: 3 });
  });
  app.get("/api/zod", () => {
    z.object({ a: z.string() }).parse({});
  });
  app.post("/api/json", (_req, res) => {
    res.sendStatus(204);
  });
  app.get("/web/boom", () => {
    throw new Error("secret detail");
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

describe("error handling", () => {
  it("returns the error envelope for AppError under /api", async () => {
    const res = await request(build()).get("/api/bad");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "BAD_REQUEST", message: "bad input" } });
  });

  it("keeps the AppError code and details", async () => {
    const res = await request(build()).get("/api/conflict");
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "OUT_OF_STOCK",
      message: "no stock",
      details: { productId: 3 },
    });
  });

  it("maps ZodError to 400 VALIDATION_ERROR", async () => {
    const res = await request(build()).get("/api/zod");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toEqual([{ path: "a", message: "Required" }]);
  });

  it("maps malformed JSON to 400", async () => {
    const res = await request(build())
      .post("/api/json")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns a JSON 404 under /api", async () => {
    const res = await request(build()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 500 INTERNAL_ERROR for unknown errors under /api", async () => {
    const res = await request(build()).get("/api/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
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
