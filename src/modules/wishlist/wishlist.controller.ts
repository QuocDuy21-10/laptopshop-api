import type { RequestHandler } from "express";
import {
  configureWishlistAlert,
  deleteWishlistItem,
  getWishlistStatus,
  getWishlistSummary,
  listWishlist,
  putWishlistItem,
} from "modules/wishlist/wishlist.service";
import type {
  ConfigurePriceAlertBody,
  WishlistProductParams,
  WishlistQuery,
  WishlistStatusQuery,
} from "modules/wishlist/wishlist.schema";

export const listWishlistHandler: RequestHandler = async (req, res) => {
  const result = await listWishlist(req.auth!.id, res.locals.query as WishlistQuery);
  res.json({ data: result.items, meta: result.meta });
};

export const getWishlistSummaryHandler: RequestHandler = async (req, res) => {
  res.json({ data: await getWishlistSummary(req.auth!.id) });
};

export const getWishlistStatusHandler: RequestHandler = async (req, res) => {
  const { productIds } = res.locals.query as WishlistStatusQuery;
  res.json({ data: await getWishlistStatus(req.auth!.id, productIds) });
};

export const putWishlistItemHandler: RequestHandler = async (req, res) => {
  const { productId } = res.locals.params as WishlistProductParams;
  res.json({ data: await putWishlistItem(req.auth!.id, productId) });
};

export const configureWishlistAlertHandler: RequestHandler = async (req, res) => {
  const { productId } = res.locals.params as WishlistProductParams;
  res.json({
    data: await configureWishlistAlert(
      req.auth!.id,
      productId,
      req.body as ConfigurePriceAlertBody,
    ),
  });
};

export const deleteWishlistItemHandler: RequestHandler = async (req, res) => {
  const { productId } = res.locals.params as WishlistProductParams;
  await deleteWishlistItem(req.auth!.id, productId);
  res.sendStatus(204);
};
