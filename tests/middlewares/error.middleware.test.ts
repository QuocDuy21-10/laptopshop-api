import express from "express";
import multer from "multer";
import request from "supertest";
import { z } from "zod";
import { AppError } from "lib/errors";
import { errorHandler, notFoundHandler } from "middlewares/error.middleware";

const build = () => {
  const app = express();
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
  app.post("/api/v1/reviews/18/images/too-large", () => {
    throw new multer.MulterError("LIMIT_FILE_SIZE");
  });
  app.post("/api/v1/reviews/18/images/too-many", () => {
    throw new multer.MulterError("LIMIT_UNEXPECTED_FILE");
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

  it("maps review image Multer limits to stable review codes", async () => {
    const tooLarge = await request(build()).post("/api/v1/reviews/18/images/too-large");
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe("REVIEW_IMAGE_TOO_LARGE");

    const tooMany = await request(build()).post("/api/v1/reviews/18/images/too-many");
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe("REVIEW_IMAGE_LIMIT_REACHED");
  });

  it("returns 500 INTERNAL_ERROR for unknown errors under /api", async () => {
    const res = await request(build()).get("/api/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns JSON for non-/api routes too", async () => {
    const res = await request(build()).get("/web/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns a JSON 404 for unknown non-/api routes", async () => {
    const res = await request(build()).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
