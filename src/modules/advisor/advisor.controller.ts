import type { RequestHandler } from "express";
import type { AdvisorService } from "modules/advisor/advisor.service";
import type { AdvisorInput } from "modules/advisor/advisor.schema";

export const createRecommendAdvisorHandler =
  (service: AdvisorService): RequestHandler =>
  async (req, res) => {
    const result = await service.recommend(req.body as AdvisorInput, req.advisorRequester!);
    res.json({ data: result });
  };
