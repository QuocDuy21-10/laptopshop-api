import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { checkValidJWT } from "middlewares/jwt.middleware";

const secret = process.env.JWT_SECRET as string;

const build = () => {
  const app = express();
  const router = express.Router();
  router.post("/login", (_req, res) => {
    res.sendStatus(200);
  });
  router.get("/account", (req, res) => {
    res.json({ id: (req.user as any).id });
  });
  app.use("/api", checkValidJWT, router);
  return app;
};

describe("checkValidJWT", () => {
  it("lets whitelisted paths through without a token", async () => {
    expect((await request(build()).post("/api/login")).status).toBe(200);
  });

  it("rejects a missing token", async () => {
    expect((await request(build()).get("/api/account")).status).toBe(401);
  });

  it("rejects a malformed header", async () => {
    const res = await request(build()).get("/api/account").set("Authorization", "Token abc");
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = jwt.sign({ id: 1 }, secret, { expiresIn: -10 });
    const res = await request(build()).get("/api/account").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = jwt.sign({ id: 1 }, "another-secret-0123456789");
    const res = await request(build()).get("/api/account").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects an unsigned (alg none) token", async () => {
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ id: 1 })).toString("base64url");
    const res = await request(build())
      .get("/api/account")
      .set("Authorization", `Bearer ${none}.${body}.`);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and exposes the payload as req.user", async () => {
    const token = jwt.sign({ id: 7 }, secret, { expiresIn: "1h" });
    const res = await request(build()).get("/api/account").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(7);
  });
});
