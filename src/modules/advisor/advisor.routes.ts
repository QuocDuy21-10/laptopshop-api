import { Router, type RequestHandler } from "express";
import { env } from "config/env";
import { optionalAuthenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import { createRecommendAdvisorHandler } from "modules/advisor/advisor.controller";
import { identifyAdvisorRequester } from "modules/advisor/advisor.identity";
import { advisorRequestSchema } from "modules/advisor/advisor.schema";
import type { AdvisorService } from "modules/advisor/advisor.service";

export type AdvisorRouteDeps = {
  service: AdvisorService;
  identitySecret?: string;
  requestLimiter?: RequestHandler;
};

const noop: RequestHandler = (_req, _res, next) => next();

export const createAdvisorRoutes = ({
  service,
  identitySecret = env.JWT_SECRET,
  requestLimiter = noop,
}: AdvisorRouteDeps) => {
  const router = Router();
  router.post(
    "/recommend",
    optionalAuthenticate,
    identifyAdvisorRequester(identitySecret),
    requestLimiter,
    validate({ body: advisorRequestSchema }),
    createRecommendAdvisorHandler(service),
  );
  return router;
};
