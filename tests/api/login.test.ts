import bcrypt from "bcrypt";
import session from "express-session";
import request from "supertest";
import { mockDeep, DeepMockProxy } from "jest-mock-extended";
import { PrismaClient } from "@prisma/client";

jest.mock("config/client", () => ({ prisma: mockDeep<PrismaClient>() }));

import { prisma } from "config/client";
import { createApp } from "../../src/app";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const app = createApp({ sessionStore: new session.MemoryStore() });

describe("POST /api/login", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "admin@gmail.com",
      password: bcrypt.hashSync("secret-pass", 4),
      role: { id: 1, name: "ADMIN", description: "" },
    } as any);
  });

  it("returns an access token for valid credentials", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: "admin@gmail.com", password: "secret-pass" });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.access_token).toBe("string");
  });

  it("returns 401 for a wrong password", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: "admin@gmail.com", password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.data).toBe("login fail");
  });

  it("returns 401 for an unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/login")
      .send({ username: "ghost@gmail.com", password: "x" });
    expect(res.status).toBe(401);
  });
});
