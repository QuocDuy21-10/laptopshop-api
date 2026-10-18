jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import bcrypt from "bcrypt";
import request from "supertest";
import { prismaError, prismaMock, refreshTokenMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { hashToken } from "modules/auth/token.service";

const row = {
  id: 1,
  username: "a@b.co",
  fullName: "A",
  address: null,
  phone: null,
  accountType: "SYSTEM",
  avatar: null,
  role: { id: 2, name: "USER" },
};
const setCookies = (res: request.Response) =>
  (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
const cookie = (res: request.Response, name: string) =>
  setCookies(res).find((c) => c.startsWith(`${name}=`)) ?? "";

beforeEach(resetPrisma);

describe("POST /api/v1/auth/register", () => {
  const body = {
    fullName: "A",
    username: "a@b.co",
    password: "password1",
    confirmPassword: "password1",
  };

  it("creates a USER with a hashed password and starts a session", async () => {
    prismaMock.role.findUnique.mockResolvedValue({ id: 2, name: "USER", description: null });
    prismaMock.user.create.mockResolvedValue(row as any);
    const res = await request(buildApp()).post("/api/v1/auth/register").send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ id: 1, username: "a@b.co", role: "USER" });
    expect(JSON.stringify(res.body)).not.toContain("password");
    const data = (prismaMock.user.create as unknown as jest.Mock).mock.calls[0][0].data;
    expect(data.roleId).toBe(2);
    expect(await bcrypt.compare("password1", data.password)).toBe(true);
    expect(cookie(res, "access_token")).toMatch(/HttpOnly/);
    expect(cookie(res, "access_token")).toMatch(/SameSite=Lax/);
    expect(cookie(res, "refresh_token")).toMatch(/Path=\/api\/v1\/auth/);
  });

  it("returns 400 when the passwords differ", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/register")
      .send({ ...body, confirmPassword: "different1" });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("confirmPassword");
  });

  it("returns 409 EMAIL_TAKEN for a duplicate username", async () => {
    prismaMock.role.findUnique.mockResolvedValue({ id: 2, name: "USER", description: null });
    prismaMock.user.create.mockRejectedValue(prismaError("P2002"));
    const res = await request(buildApp()).post("/api/v1/auth/register").send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });
});

describe("POST /api/v1/auth/login", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...row,
      password: bcrypt.hashSync("password1", 4),
    } as any);
  });

  it("returns the user and sets both cookies", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/login")
      .send({ username: "a@b.co", password: "password1" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("password");
    expect(cookie(res, "access_token")).not.toBe("");
    expect(cookie(res, "refresh_token")).not.toBe("");
  });

  it("returns 401 INVALID_CREDENTIALS for a wrong password", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/login")
      .send({ username: "a@b.co", password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 401 for an unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/login")
      .send({ username: "ghost@b.co", password: "password1" });
    expect(res.status).toBe(401);
  });

  it("rejects a login posted from a foreign origin", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ username: "a@b.co", password: "password1" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("returns 401 without a refresh cookie", async () => {
    const res = await request(buildApp()).post("/api/v1/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rotates the token and returns the user", async () => {
    refreshTokenMock.findUnique.mockResolvedValue({
      id: 10,
      familyId: "fam-1",
      userId: 1,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: row,
    });
    refreshTokenMock.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(buildApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", "refresh_token=tok");
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(1);
    expect(refreshTokenMock.findUnique.mock.calls[0][0].where).toEqual({
      tokenHash: hashToken("tok"),
    });
    expect(cookie(res, "refresh_token")).not.toMatch(/^refresh_token=tok;/);
  });

  it("clears the cookies when the token is invalid", async () => {
    refreshTokenMock.findUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", "refresh_token=bad");
    expect(res.status).toBe(401);
    expect(cookie(res, "access_token")).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the family and clears the cookies", async () => {
    refreshTokenMock.findUnique.mockResolvedValue({ id: 10, familyId: "fam-1" });
    refreshTokenMock.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(buildApp())
      .post("/api/v1/auth/logout")
      .set("Cookie", "refresh_token=tok");
    expect(res.status).toBe(204);
    expect(refreshTokenMock.updateMany.mock.calls[0][0].where).toEqual({
      familyId: "fam-1",
      revokedAt: null,
    });
    expect(cookie(res, "refresh_token")).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("is idempotent without a cookie", async () => {
    expect((await request(buildApp()).post("/api/v1/auth/logout")).status).toBe(204);
  });
});
