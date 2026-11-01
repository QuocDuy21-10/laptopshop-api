import { Router } from "express";

import { idParams } from "lib/http";
import { validate } from "middlewares/validate";
import {
  adminListHomeBannersQuery,
  createHomeBannerBody,
  patchHomeBannerBody,
} from "modules/home-banners/home-banners.schema";
import {
  createHomeBannerHandler,
  deleteHomeBannerHandler,
  getHomeBannerHandler,
  listAdminHomeBannersHandler,
  listPublicHomeBannersHandler,
  updateHomeBannerHandler,
} from "modules/home-banners/home-banners.controller";

export const homeBannerRoutes = Router();
homeBannerRoutes.get("/", listPublicHomeBannersHandler);

export const adminHomeBannerRoutes = Router();
adminHomeBannerRoutes.get(
  "/",
  validate({ query: adminListHomeBannersQuery }),
  listAdminHomeBannersHandler,
);
adminHomeBannerRoutes.post("/", validate({ body: createHomeBannerBody }), createHomeBannerHandler);
adminHomeBannerRoutes.get("/:id", validate({ params: idParams }), getHomeBannerHandler);
adminHomeBannerRoutes.patch(
  "/:id",
  validate({ params: idParams, body: patchHomeBannerBody }),
  updateHomeBannerHandler,
);
adminHomeBannerRoutes.delete("/:id", validate({ params: idParams }), deleteHomeBannerHandler);
