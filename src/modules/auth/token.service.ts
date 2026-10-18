import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "config/client";
import { env } from "config/env";
import { AppError } from "lib/errors";
import { userSelect, UserRow } from "modules/users/users.mapper";

export type AuthUser = { id: number; role: string };
export type ClientMeta = { userAgent?: string; ip?: string };
export type IssuedRefresh = { token: string; expiresAt: Date };

export const signAccessToken = (user: AuthUser) =>
  jwt.sign({ role: user.role }, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: String(user.id),
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
  });

export const verifyAccessToken = (token: string): AuthUser => {
  const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
  const id = Number(payload.sub);
  if (!Number.isInteger(id) || typeof payload.role !== "string") {
    throw new Error("malformed access token");
  }
  return { id, role: payload.role };
};

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const invalidRefresh = () => new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");

export const issueRefreshToken = async (
  userId: number,
  meta: ClientMeta,
  familyId: string = crypto.randomUUID(),
): Promise<IssuedRefresh> => {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
      familyId,
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
      ip: meta.ip?.slice(0, 64),
    },
  });
  return { token, expiresAt };
};

export const revokeFamily = (familyId: string) =>
  prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const rotateRefreshToken = async (
  token: string,
  meta: ClientMeta,
): Promise<{ user: UserRow; refresh: IssuedRefresh }> => {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: userSelect } },
  });
  if (!existing || existing.expiresAt <= new Date()) throw invalidRefresh();
  if (existing.revokedAt) {
    // a revoked token coming back means it was stolen: kill every session in the family
    await revokeFamily(existing.familyId);
    throw invalidRefresh();
  }
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    await revokeFamily(existing.familyId);
    throw invalidRefresh();
  }
  const refresh = await issueRefreshToken(existing.userId, meta, existing.familyId);
  return { user: existing.user, refresh };
};

export const revokeByToken = async (token: string) => {
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (existing) await revokeFamily(existing.familyId);
};
