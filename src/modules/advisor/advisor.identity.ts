import crypto from "crypto";
import type { RequestHandler } from "express";

export const identifyAdvisorRequester =
  (secret: string): RequestHandler =>
  (req, _res, next) => {
    if (req.auth) {
      req.advisorRequester = { kind: "user", key: String(req.auth.id) };
    } else {
      const ip = req.ip || "unknown";
      req.advisorRequester = {
        kind: "guest",
        key: crypto.createHmac("sha256", secret).update(`advisor-ip:${ip}`).digest("hex"),
      };
    }
    next();
  };
