import express from "express";
import request from "supertest";
import { createLimiters } from "middlewares/rate-limit";
import { optionalAuthenticate } from "middlewares/authenticate";
import { identifyAdvisorRequester } from "modules/advisor/advisor.identity";
import { cookieFor, USER } from "../helpers/auth";

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

  it("exposes a dedicated review image limiter", () => {
    const { reviewImagesLimiter } = createLimiters();
    expect(reviewImagesLimiter).toBeDefined();
  });

  it("exposes a user-keyed review mutation limiter", () => {
    const { reviewMutationLimiter } = createLimiters();
    expect(reviewMutationLimiter).toBeDefined();
  });

  it("limits advisor requests to 20 per requester and returns the standard error envelope", async () => {
    const app = express();
    const { advisorLimiter } = createLimiters();
    app.post(
      "/advisor",
      optionalAuthenticate,
      identifyAdvisorRequester("secret"),
      advisorLimiter,
      (_req, res) => {
        res.sendStatus(200);
      },
    );
    for (let i = 0; i < 20; i++) expect((await request(app).post("/advisor")).status).toBe(200);
    const blocked = await request(app).post("/advisor");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("keeps advisor limiter counters separate for authenticated users", async () => {
    const app = express();
    const { advisorLimiter } = createLimiters();
    app.post(
      "/advisor",
      optionalAuthenticate,
      identifyAdvisorRequester("secret"),
      advisorLimiter,
      (_req, res) => {
        res.sendStatus(200);
      },
    );
    for (let i = 0; i < 20; i++) {
      expect((await request(app).post("/advisor").set("Cookie", cookieFor(USER))).status).toBe(200);
    }
    expect((await request(app).post("/advisor").set("Cookie", cookieFor(USER))).status).toBe(429);
    expect(
      (
        await request(app)
          .post("/advisor")
          .set("Cookie", cookieFor({ id: 2, role: "USER" }))
      ).status,
    ).toBe(200);
  });
});
