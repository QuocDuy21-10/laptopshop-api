jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import jwt from "jsonwebtoken";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import {
  hashToken,
  issueRefreshToken,
  revokeByToken,
  rotateRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "modules/auth/token.service";

const secret = process.env.JWT_SECRET as string;
const userRow = {
  id: 1,
  username: "a@b.co",
  fullName: "A",
  address: null,
  phone: null,
  accountType: "SYSTEM",
  avatar: null,
  role: { id: 2, name: "USER" },
};
const stored = (over: Record<string, unknown> = {}) =>
  ({
    id: 10,
    tokenHash: "h",
    familyId: "fam-1",
    userId: 1,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    userAgent: null,
    ip: null,
    createdAt: new Date(),
    user: userRow,
    ...over,
  }) as any;

beforeEach(resetPrisma);

describe("access tokens", () => {
  it("round-trips id and role", () => {
    expect(verifyAccessToken(signAccessToken({ id: 5, role: "ADMIN" }))).toEqual({
      id: 5,
      role: "ADMIN",
    });
  });

  it("rejects a token signed with another secret", () => {
    const t = jwt.sign({ role: "ADMIN" }, "another-secret-0123456789", { subject: "5" });
    expect(() => verifyAccessToken(t)).toThrow();
  });

  it("rejects an unsigned (alg none) token", () => {
    const head = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "5", role: "ADMIN" })).toString("base64url");
    expect(() => verifyAccessToken(`${head}.${body}.`)).toThrow();
  });

  it("rejects a payload without a numeric subject", () => {
    const t = jwt.sign({ role: "USER" }, secret, { subject: "abc" });
    expect(() => verifyAccessToken(t)).toThrow();
  });
});

describe("refresh tokens", () => {
  it("stores only the hash of a new token", async () => {
    const { token, expiresAt } = await issueRefreshToken(1, { userAgent: "jest", ip: "1.2.3.4" });
    const data = (prismaMock.refreshToken.create.mock.calls[0][0] as any).data;
    expect(data.tokenHash).toBe(hashToken(token));
    expect(data.tokenHash).not.toBe(token);
    expect(data.userId).toBe(1);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });

  it("rotates within the same family", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(stored());
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    const { user, refresh } = await rotateRefreshToken("old", {});
    expect(prismaMock.refreshToken.findUnique.mock.calls[0][0].where).toEqual({
      tokenHash: hashToken("old"),
    });
    expect(user.id).toBe(1);
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 10, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect((prismaMock.refreshToken.create.mock.calls[0][0] as any).data.familyId).toBe("fam-1");
    expect(refresh.token).not.toBe("old");
  });

  it("rejects an unknown token", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(null);
    await expect(rotateRefreshToken("x", {})).rejects.toMatchObject({
      status: 401,
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("rejects an expired token", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(stored({ expiresAt: new Date(1) }));
    await expect(rotateRefreshToken("x", {})).rejects.toMatchObject({ status: 401 });
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it("revokes the whole family when a revoked token is reused", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(stored({ revokedAt: new Date() }));
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    await expect(rotateRefreshToken("x", {})).rejects.toMatchObject({ status: 401 });
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it("treats a lost rotation race as reuse", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(stored());
    prismaMock.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 2 });
    await expect(rotateRefreshToken("x", {})).rejects.toMatchObject({ status: 401 });
    expect(prismaMock.refreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { familyId: "fam-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("revokeByToken revokes the token's family", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(stored());
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await revokeByToken("x");
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
