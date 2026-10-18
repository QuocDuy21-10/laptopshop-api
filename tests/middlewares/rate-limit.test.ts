import express from "express";
import request from "supertest";
import { createLimiters } from "middlewares/rate-limit";

describe("rate limiters", () => {
  it("blocks the 11th POST /login within the window", async () => {
    const app = express();
    const { authLimiter } = createLimiters();
    app.post("/login", authLimiter, (_req, res) => {
      res.sendStatus(200);
    });
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post("/login")).status).toBe(200);
    }
    const blocked = await request(app).post("/login");
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toMatch(/too many/i);
  });

  it("global limiter allows normal traffic", async () => {
    const app = express();
    app.use(createLimiters().globalLimiter);
    app.get("/", (_req, res) => {
      res.sendStatus(200);
    });
    expect((await request(app).get("/")).status).toBe(200);
  });
});
