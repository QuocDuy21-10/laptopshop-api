import type { RequestHandler } from "express";

import type { IdParams } from "lib/http";
import { AppError } from "lib/errors";
import { removeBannerImageFile } from "modules/home-banners/home-banners.files";
import { homeBannerImageBody } from "modules/home-banners/home-banners.schema";
import type {
  AdminListHomeBannersQuery,
  CreateHomeBannerBody,
  PatchHomeBannerBody,
} from "modules/home-banners/home-banners.schema";
import {
  clearHomeBannerImage,
  createHomeBanner,
  deleteHomeBanner,
  getAdminHomeBanner,
  listAdminHomeBanners,
  listPublicHomeBanners,
  setHomeBannerImage,
  updateHomeBanner,
} from "modules/home-banners/home-banners.service";

export const listPublicHomeBannersHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await listPublicHomeBanners() });
};

export const listAdminHomeBannersHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await listAdminHomeBanners(res.locals.query as AdminListHomeBannersQuery) });
};

export const getHomeBannerHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getAdminHomeBanner((res.locals.params as IdParams).id) });
};

export const createHomeBannerHandler: RequestHandler = async (req, res) => {
  res.status(201).json({ data: await createHomeBanner(req.body as CreateHomeBannerBody) });
};

export const updateHomeBannerHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await updateHomeBanner(id, req.body as PatchHomeBannerBody) });
};

export const deleteHomeBannerHandler: RequestHandler = async (_req, res) => {
  await deleteHomeBanner((res.locals.params as IdParams).id);
  res.sendStatus(204);
};

export const uploadHomeBannerImageHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  const file = req.file;
  try {
    if (!file) throw new AppError("Image file is required", 400, "VALIDATION_ERROR");
    const { imageAlt } = homeBannerImageBody.parse(req.body ?? {});
    res.json({ data: await setHomeBannerImage(id, file.filename, imageAlt) });
  } catch (error) {
    // the middleware already wrote the file; do not leave an orphan behind a rejected request
    if (file) await removeBannerImageFile(file.filename);
    throw error;
  }
};

export const clearHomeBannerImageHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await clearHomeBannerImage((res.locals.params as IdParams).id) });
};
