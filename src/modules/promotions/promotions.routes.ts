import { Router } from "express";
import { validate } from "middlewares/validate";
import {
  adminPromotionQuery,
  createPromotionBody,
  promotionIdParams,
  promotionRedemptionQuery,
  transitionPromotionBody,
  updatePromotionBody,
} from "modules/promotions/promotions.schema";
import {
  clonePromotionHandler,
  createPromotionHandler,
  getPromotionHandler,
  getPromotionSummaryHandler,
  listPromotionRedemptionsHandler,
  listAvailablePromotionsHandler,
  listPromotionsHandler,
  transitionPromotionHandler,
  updatePromotionHandler,
} from "modules/promotions/promotions.controller";

export const adminPromotionRoutes = Router();
export const promotionRoutes = Router();

promotionRoutes.get("/available", listAvailablePromotionsHandler);

adminPromotionRoutes.get("/", validate({ query: adminPromotionQuery }), listPromotionsHandler);
adminPromotionRoutes.post("/", validate({ body: createPromotionBody }), createPromotionHandler);
adminPromotionRoutes.get("/:id", validate({ params: promotionIdParams }), getPromotionHandler);
adminPromotionRoutes.patch(
  "/:id",
  validate({ params: promotionIdParams, body: updatePromotionBody }),
  updatePromotionHandler,
);
adminPromotionRoutes.patch(
  "/:id/state",
  validate({ params: promotionIdParams, body: transitionPromotionBody }),
  transitionPromotionHandler,
);
adminPromotionRoutes.post(
  "/:id/clone",
  validate({ params: promotionIdParams }),
  clonePromotionHandler,
);
adminPromotionRoutes.get(
  "/:id/redemptions",
  validate({ params: promotionIdParams, query: promotionRedemptionQuery }),
  listPromotionRedemptionsHandler,
);
adminPromotionRoutes.get(
  "/:id/summary",
  validate({ params: promotionIdParams }),
  getPromotionSummaryHandler,
);
