import { Request, RequestHandler, Response } from "express";
import { AppError } from "lib/errors";
import { readCookie } from "lib/cookies";
import { toUserDto, UserRow } from "modules/users/users.mapper";
import { LoginBody, RegisterBody } from "modules/auth/auth.schema";
import { loginUser, registerUser } from "modules/auth/auth.service";
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "modules/auth/auth.cookies";
import {
  issueRefreshToken,
  revokeByToken,
  rotateRefreshToken,
  signAccessToken,
} from "modules/auth/token.service";

const clientMeta = (req: Request) => ({ userAgent: req.get("user-agent"), ip: req.ip });

const startSession = async (req: Request, res: Response, user: UserRow) => {
  const refresh = await issueRefreshToken(user.id, clientMeta(req));
  setAuthCookies(res, signAccessToken({ id: user.id, role: user.role.name }), refresh);
};

export const register: RequestHandler = async (req, res) => {
  const user = await registerUser(req.body as RegisterBody);
  await startSession(req, res, user);
  res.status(201).json({ data: { user: toUserDto(user) } });
};

export const login: RequestHandler = async (req, res) => {
  const { username, password } = req.body as LoginBody;
  const user = await loginUser(username, password);
  await startSession(req, res, user);
  res.json({ data: { user: toUserDto(user) } });
};

export const refresh: RequestHandler = async (req, res) => {
  const token = readCookie(req, REFRESH_COOKIE);
  try {
    if (!token) throw new AppError("Missing refresh token", 401, "INVALID_REFRESH_TOKEN");
    const { user, refresh: next } = await rotateRefreshToken(token, clientMeta(req));
    setAuthCookies(res, signAccessToken({ id: user.id, role: user.role.name }), next);
    res.json({ data: { user: toUserDto(user) } });
  } catch (e) {
    clearAuthCookies(res);
    throw e;
  }
};

export const logout: RequestHandler = async (req, res) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (token) await revokeByToken(token);
  clearAuthCookies(res);
  res.sendStatus(204);
};
