import { Express } from "express";
import { logger } from "lib/logger";

export const registerHealthRoutes = (app: Express, checks: Array<() => Promise<unknown>>) => {
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await Promise.all(checks.map((check) => check()));
      res.status(200).json({ status: "ok" });
    } catch (err) {
      logger.error({ err }, "readiness check failed");
      res.status(503).json({ status: "unavailable" });
    }
  });
};
