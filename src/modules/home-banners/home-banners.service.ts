import { type HomeBanner, type Prisma } from "@prisma/client";

import { AppError, notFound } from "lib/errors";
import { prisma } from "config/client";
import { removeBannerImageFile } from "modules/home-banners/home-banners.files";
import {
  toAdminHomeBannerDto,
  toBadges,
  toPublicHomeBannerDto,
} from "modules/home-banners/home-banners.mapper";
import {
  bannerShapeIssues,
  type AdminListHomeBannersQuery,
  type CreateHomeBannerBody,
  type HomeBannerPlacementValue,
  type PatchHomeBannerBody,
} from "modules/home-banners/home-banners.schema";

const PUBLIC_LIMIT: Record<HomeBannerPlacementValue, number> = { HERO: 5, SIDE: 3 };

const findPublic = (placement: HomeBannerPlacementValue, now: Date) =>
  prisma.homeBanner.findMany({
    where: {
      placement,
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: PUBLIC_LIMIT[placement],
  });

export const listPublicHomeBanners = async (now = new Date()) => {
  const [hero, side] = await Promise.all([findPublic("HERO", now), findPublic("SIDE", now)]);
  return { hero: hero.map(toPublicHomeBannerDto), side: side.map(toPublicHomeBannerDto) };
};

export const listAdminHomeBanners = async (query: AdminListHomeBannersQuery, now = new Date()) => {
  const rows = await prisma.homeBanner.findMany({
    where: { placement: query.placement },
    orderBy: [{ placement: "asc" }, { position: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => toAdminHomeBannerDto(row, now));
};

export const findHomeBannerOrThrow = async (id: number): Promise<HomeBanner> => {
  const row = await prisma.homeBanner.findUnique({ where: { id } });
  if (!row) throw notFound("Home banner");
  return row;
};

export const getAdminHomeBanner = async (id: number, now = new Date()) =>
  toAdminHomeBannerDto(await findHomeBannerOrThrow(id), now);

export const createHomeBanner = async (body: CreateHomeBannerBody) => {
  const row = await prisma.homeBanner.create({
    data: {
      placement: body.placement,
      title: body.title,
      eyebrow: body.eyebrow ?? null,
      highlight: body.highlight ?? null,
      description: body.description ?? null,
      ctaText: body.ctaText ?? null,
      linkUrl: body.linkUrl ?? null,
      secondaryCtaText: body.secondaryCtaText ?? null,
      secondaryLinkUrl: body.secondaryLinkUrl ?? null,
      badges: body.badges ?? [],
      position: body.position ?? 0,
      isActive: body.isActive ?? false,
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
    },
  });
  return toAdminHomeBannerDto(row, new Date());
};

export const updateHomeBanner = async (id: number, body: PatchHomeBannerBody) => {
  const existing = await findHomeBannerOrThrow(id);
  const merged = {
    placement: existing.placement,
    ctaText: body.ctaText === undefined ? existing.ctaText : body.ctaText,
    linkUrl: body.linkUrl === undefined ? existing.linkUrl : body.linkUrl,
    secondaryCtaText:
      body.secondaryCtaText === undefined ? existing.secondaryCtaText : body.secondaryCtaText,
    secondaryLinkUrl:
      body.secondaryLinkUrl === undefined ? existing.secondaryLinkUrl : body.secondaryLinkUrl,
    badges: body.badges ?? toBadges(existing.badges),
    imagePath: existing.imagePath,
    imageAlt: body.imageAlt === undefined ? existing.imageAlt : body.imageAlt,
    startsAt: body.startsAt === undefined ? existing.startsAt : body.startsAt,
    endsAt: body.endsAt === undefined ? existing.endsAt : body.endsAt,
  };
  const issues = bannerShapeIssues(merged);
  if (issues.length) throw new AppError("Validation failed", 400, "VALIDATION_ERROR", issues);
  const data: Prisma.HomeBannerUpdateInput = { ...body };
  const row = await prisma.homeBanner.update({ where: { id }, data });
  return toAdminHomeBannerDto(row, new Date());
};

export const deleteHomeBanner = async (id: number) => {
  const existing = await findHomeBannerOrThrow(id);
  await prisma.homeBanner.delete({ where: { id } });
  await removeBannerImageFile(existing.imagePath);
};

// the file already sits on disk (upload middleware runs first); the controller deletes it if this throws
export const setHomeBannerImage = async (
  id: number,
  filename: string,
  imageAlt: string | undefined,
) => {
  const existing = await findHomeBannerOrThrow(id);
  const alt = imageAlt ?? existing.imageAlt;
  if (alt === null)
    throw new AppError("Validation failed", 400, "VALIDATION_ERROR", [
      { path: "imageAlt", message: "imageAlt is required when the banner has an image" },
    ]);
  const row = await prisma.homeBanner.update({
    where: { id },
    data: { imagePath: filename, imageAlt: alt },
  });
  await removeBannerImageFile(existing.imagePath);
  return toAdminHomeBannerDto(row, new Date());
};

export const clearHomeBannerImage = async (id: number) => {
  const existing = await findHomeBannerOrThrow(id);
  const row = await prisma.homeBanner.update({
    where: { id },
    data: { imagePath: null, imageAlt: null },
  });
  await removeBannerImageFile(existing.imagePath);
  return toAdminHomeBannerDto(row, new Date());
};
