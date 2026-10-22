import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  configureWishlistAlertHandler,
  deleteWishlistItemHandler,
  getWishlistStatusHandler,
  getWishlistSummaryHandler,
  listWishlistHandler,
  putWishlistItemHandler,
} from "modules/wishlist/wishlist.controller";
import {
  configurePriceAlertBody,
  wishlistProductParams,
  wishlistQuery,
  wishlistStatusQuery,
} from "modules/wishlist/wishlist.schema";

export const wishlistRoutes = Router();

wishlistRoutes.use(authenticate);
wishlistRoutes.get("/", validate({ query: wishlistQuery }), listWishlistHandler);
wishlistRoutes.get("/summary", getWishlistSummaryHandler);
wishlistRoutes.get("/status", validate({ query: wishlistStatusQuery }), getWishlistStatusHandler);
wishlistRoutes.put(
  "/items/:productId",
  validate({ params: wishlistProductParams }),
  putWishlistItemHandler,
);
wishlistRoutes.patch(
  "/items/:productId",
  validate({ params: wishlistProductParams, body: configurePriceAlertBody }),
  configureWishlistAlertHandler,
);
wishlistRoutes.delete(
  "/items/:productId",
  validate({ params: wishlistProductParams }),
  deleteWishlistItemHandler,
);
