import pino from "pino";
import { env } from "config/env";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "req.remoteAddress",
      "req.remotePort",
      "*.password",
    ],
    censor: "[REDACTED]",
  },
  ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
});
