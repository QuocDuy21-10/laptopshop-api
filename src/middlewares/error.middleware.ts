import type {} from "pino-http"; // adds req.log to the Request type
import { ErrorRequestHandler, RequestHandler } from "express";
import { env } from "config/env";
import { AppError } from "lib/errors";
import { logger } from "lib/logger";

const isApi = (url: string) => url === "/api" || url.startsWith("/api/");

export const notFoundHandler: RequestHandler = (req, res) => {
  if (isApi(req.originalUrl)) {
    res.status(404).json({ data: null, message: "Not found" });
    return;
  }
  res.status(404).render("status/404.ejs");
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = err instanceof AppError ? err.status : err?.name === "MulterError" ? 400 : 500;
  if (status >= 500) {
    (req.log ?? logger).error({ err }, "unhandled error");
  }
  const message =
    status >= 500 && env.NODE_ENV === "production" ? "Internal Server Error" : err.message;

  if (isApi(req.originalUrl)) {
    res.status(status).json({ data: null, message });
    return;
  }
  res
    .status(status)
    .render(
      status === 403 ? "status/403.ejs" : status === 404 ? "status/404.ejs" : "status/500.ejs",
    );
};
