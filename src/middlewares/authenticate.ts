import { RequestHandler } from "express";
import { AppError } from "lib/errors";
import { readCookie } from "lib/cookies";
import { ACCESS_COOKIE } from "modules/auth/auth.cookies";
import { verifyAccessToken } from "modules/auth/token.service";

const accessTokenFrom = (req: Parameters<RequestHandler>[0]) => {
  const header = req.headers.authorization;
  return (
    readCookie(req, ACCESS_COOKIE) ?? (header?.startsWith("Bearer ") ? header.slice(7) : undefined)
  );
};

const authenticateToken = (
  req: Parameters<RequestHandler>[0],
  token: string,
  next: Parameters<RequestHandler>[2],
) => {
  try {
    req.auth = verifyAccessToken(token);
  } catch {
    next(new AppError("Invalid or expired token", 401, "UNAUTHENTICATED"));
    return false;
  }
  next();
  return true;
};

export const authenticate: RequestHandler = (req, _res, next) => {
  const token = accessTokenFrom(req);
  if (!token) {
    next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
    return;
  }
  authenticateToken(req, token, next);
};

export const optionalAuthenticate: RequestHandler = (req, _res, next) => {
  const token = accessTokenFrom(req);
  if (!token) {
    next();
    return;
  }
  authenticateToken(req, token, next);
};
