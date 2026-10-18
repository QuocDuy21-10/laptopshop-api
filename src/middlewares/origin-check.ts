import { RequestHandler } from "express";
import { AppError } from "lib/errors";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const originCheck =
  (allowed: string[]): RequestHandler =>
  (req, _res, next) => {
    const origin = req.headers.origin;
    if (UNSAFE.has(req.method) && origin && !allowed.includes(origin)) {
      next(new AppError("Origin not allowed", 403, "FORBIDDEN_ORIGIN"));
      return;
    }
    next();
  };
