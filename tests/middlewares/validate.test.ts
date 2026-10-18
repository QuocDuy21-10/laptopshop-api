import express from "express";
import request from "supertest";
import { z } from "zod";
import { validate } from "middlewares/validate";
import { errorHandler } from "middlewares/error.middleware";

const build = () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/api/items/:id",
    validate({
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({ q: z.string().default("x") }),
      body: z.object({ n: z.number() }),
    }),
    (req, res) => {
      res.json({ params: res.locals.params, query: res.locals.query, body: req.body });
    },
  );
  app.use(errorHandler);
  return app;
};

describe("validate", () => {
  it("parses params, query and body and strips unknown keys", async () => {
    const res = await request(build()).post("/api/items/5").send({ n: 1, extra: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { id: 5 }, query: { q: "x" }, body: { n: 1 } });
  });

  it("rejects bad input with 400 VALIDATION_ERROR", async () => {
    const res = await request(build()).post("/api/items/abc").send({ n: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("id");
  });

  it("treats a missing body as an empty object", async () => {
    const res = await request(build()).post("/api/items/5");
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("n");
  });
});
