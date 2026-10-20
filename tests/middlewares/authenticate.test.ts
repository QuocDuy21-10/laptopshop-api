jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { authenticate, optionalAuthenticate } from "middlewares/authenticate";
import { requireRole } from "middlewares/require-role";
import { errorHandler } from "middlewares/error.middleware";
import { signAccessToken } from "modules/auth/token.service";
import { ADMIN, USER, cookieFor } from "../helpers/auth";

const build = () => {
  const app = express();
  app.get("/api/me", authenticate, (req, res) => {
    res.json(req.auth);
  });
  app.get("/api/optional", optionalAuthenticate, (req, res) => {
    res.json(req.auth ?? null);
  });
  app.get("/api/admin", authenticate, requireRole("ADMIN"), (_req, res) => {
    res.sendStatus(204);
  });
  app.use(errorHandler);
  return app;
};

describe("authenticate", () => {
  it("reads the access token cookie", async () => {
    const res = await request(build()).get("/api/me").set("Cookie", cookieFor(USER));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(USER);
  });

  it("falls back to a bearer token", async () => {
    const res = await request(build())
      .get("/api/me")
      .set("Authorization", `Bearer ${signAccessToken(ADMIN)}`);
    expect(res.body).toEqual(ADMIN);
  });

  it("returns 401 without a token", async () => {
    const res = await request(build()).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 for an expired token", async () => {
    const t = jwt.sign({ role: "USER" }, process.env.JWT_SECRET as string, {
      subject: "1",
      expiresIn: -10,
    });
    const res = await request(build()).get("/api/me").set("Cookie", `access_token=${t}`);
    expect(res.status).toBe(401);
  });

  it("allows an optional route without a token", async () => {
    const res = await request(build()).get("/api/optional");
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("uses a valid cookie or bearer token on an optional route", async () => {
    expect(
      (await request(build()).get("/api/optional").set("Cookie", cookieFor(USER))).body,
    ).toEqual(USER);
    expect(
      (
        await request(build())
          .get("/api/optional")
          .set("Authorization", `Bearer ${signAccessToken(ADMIN)}`)
      ).body,
    ).toEqual(ADMIN);
  });

  it("rejects an invalid token on an optional route", async () => {
    const res = await request(build()).get("/api/optional").set("Cookie", "access_token=invalid");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each(["", "Basic abc"])("rejects malformed authorization %j", async (authorization) => {
    const res = await request(build()).get("/api/optional").set("Authorization", authorization);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("accepts lowercase bearer with surrounding whitespace", async () => {
    const res = await request(build())
      .get("/api/optional")
      .set("Authorization", ` bearer ${signAccessToken(USER)} `);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(USER);
  });

  it("rejects a malformed percent-encoded access cookie", async () => {
    const res = await request(build()).get("/api/optional").set("Cookie", "access_token=%ZZ");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("requireRole", () => {
  it("returns 403 for a USER", async () => {
    const res = await request(build()).get("/api/admin").set("Cookie", cookieFor(USER));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("lets an ADMIN through", async () => {
    const res = await request(build()).get("/api/admin").set("Cookie", cookieFor(ADMIN));
    expect(res.status).toBe(204);
  });
});
