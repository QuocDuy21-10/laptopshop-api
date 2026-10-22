import { RequestHandler } from "express";
import { IdParams } from "lib/http";
import {
  AdminPromotionQuery,
  CreatePromotionBody,
  PromotionIdParams,
  PromotionRedemptionQuery,
  TransitionPromotionBody,
  UpdatePromotionBody,
  FlashSaleAllocationQuery,
} from "modules/promotions/promotions.schema";
import {
  clonePromotion,
  createPromotion,
  getPromotion,
  getPromotionSummary,
  listPromotionRedemptions,
  listPromotions,
  transitionPromotion,
  updatePromotion,
  listFlashSaleAllocations,
} from "modules/promotions/promotions.service";
import { listAvailablePromotions, quoteOrder } from "modules/promotions/promotions.service";
import { getFlashSaleAvailability } from "modules/promotions/flash-sale-availability";
import type { FlashSaleAvailabilityQuery } from "modules/promotions/promotions.schema";

export const quoteOrderHandler: RequestHandler = async (req, res) => {
  res.json({ data: await quoteOrder(req.auth!.id, req.body?.couponCode) });
};

export const listAvailablePromotionsHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await listAvailablePromotions() });
};

export const flashSaleAvailabilityHandler: RequestHandler = async (req, res) => {
  const query = res.locals.query as FlashSaleAvailabilityQuery;
  res.json({
    data: await getFlashSaleAvailability({
      productIds: query.productIds,
      userId: req.auth?.id,
      now: new Date(),
    }),
  });
};

export const createPromotionHandler: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json({ data: await createPromotion(req.auth!.id, req.body as CreatePromotionBody) });
};

export const listPromotionsHandler: RequestHandler = async (_req, res) => {
  const result = await listPromotions(res.locals.query as AdminPromotionQuery);
  res.json(result);
};

export const getPromotionHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getPromotion((res.locals.params as PromotionIdParams).id) });
};

export const updatePromotionHandler: RequestHandler = async (req, res) => {
  res.json({
    data: await updatePromotion(
      (res.locals.params as PromotionIdParams).id,
      req.auth!.id,
      req.body as UpdatePromotionBody,
    ),
  });
};

export const transitionPromotionHandler: RequestHandler = async (req, res) => {
  res.json({
    data: await transitionPromotion(
      (res.locals.params as PromotionIdParams).id,
      req.auth!.id,
      (req.body as TransitionPromotionBody).action,
    ),
  });
};

export const clonePromotionHandler: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json({ data: await clonePromotion((res.locals.params as IdParams).id, req.auth!.id) });
};

export const listPromotionRedemptionsHandler: RequestHandler = async (_req, res) => {
  const result = await listPromotionRedemptions(
    (res.locals.params as PromotionIdParams).id,
    res.locals.query as PromotionRedemptionQuery,
  );
  res.json(result);
};

export const getPromotionSummaryHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getPromotionSummary((res.locals.params as PromotionIdParams).id) });
};

export const listFlashSaleAllocationsHandler: RequestHandler = async (_req, res) => {
  const result = await listFlashSaleAllocations(
    (res.locals.params as PromotionIdParams).id,
    res.locals.query as FlashSaleAllocationQuery,
  );
  res.json(result);
};
