import type {} from "pino-http"; // adds req.log to the Request type
import { ErrorRequestHandler, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { env } from "config/env";
import { AppError } from "lib/errors";
import { logger } from "lib/logger";

const sendError = (
  res: Response,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) => {
  res.status(status).json({ error: { code, message, ...extra } });
};

const toAppError = (err: any): AppError | undefined => {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return new AppError("Validation failed", 400, "VALIDATION_ERROR", details);
  }
  if (err?.name === "MulterError") return new AppError(err.message, 400, "UPLOAD_ERROR");
  // body-parser errors (malformed JSON, payload too large) carry a safe 4xx status
  if (err?.expose && typeof err.status === "number" && err.status < 500) {
    return new AppError(err.message, err.status);
  }
  return undefined;
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, "NOT_FOUND", "Not found");
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const known = toAppError(err);
  const status = known?.status ?? 500;
  if (status >= 500) {
    (req.log ?? logger).error({ err }, "unhandled error");
  }

  const isProd = env.NODE_ENV === "production";
  const message =
    status >= 500 && isProd ? "Internal Server Error" : (known?.message ?? err.message);
  const extra: Record<string, unknown> = {};
  if (known?.details !== undefined) extra.details = known.details;
  if (status >= 500 && !isProd) extra.stack = err.stack;
  sendError(res, status, known?.code ?? "INTERNAL_ERROR", message, extra);
};
