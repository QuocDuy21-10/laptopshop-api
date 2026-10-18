import { RequestHandler } from "express";
import { AppError } from "lib/errors";
import { readCookie } from "lib/cookies";
import { ACCESS_COOKIE } from "modules/auth/auth.cookies";
import { verifyAccessToken } from "modules/auth/token.service";

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token =
    readCookie(req, ACCESS_COOKIE) ?? (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  if (!token) {
    next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
    return;
  }
  try {
    req.auth = verifyAccessToken(token);
  } catch {
    next(new AppError("Invalid or expired token", 401, "UNAUTHENTICATED"));
    return;
  }
  next();
};
