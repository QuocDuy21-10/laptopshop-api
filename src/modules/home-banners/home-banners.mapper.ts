import type { HomeBanner, Prisma } from "@prisma/client";

import { BANNER_IMAGE_DIR } from "modules/home-banners/home-banners.files";

export type HomeBannerStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "INACTIVE";

export const homeBannerImageUrl = (imagePath: string | null) =>
  imagePath ? `/${BANNER_IMAGE_DIR}/${imagePath}` : null;

export const toBadges = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

// a switched-off banner is INACTIVE whatever its schedule says
export const bannerStatus = (
  banner: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): HomeBannerStatus => {
  if (!banner.isActive) return "INACTIVE";
  if (banner.endsAt && banner.endsAt <= now) return "EXPIRED";
  if (banner.startsAt && banner.startsAt > now) return "SCHEDULED";
  return "ACTIVE";
};

export const toPublicHomeBannerDto = (row: HomeBanner) => ({
  id: row.id,
  eyebrow: row.eyebrow,
  title: row.title,
  highlight: row.highlight,
  description: row.description,
  ctaText: row.ctaText,
  linkUrl: row.linkUrl,
  secondaryCtaText: row.secondaryCtaText,
  secondaryLinkUrl: row.secondaryLinkUrl,
  badges: toBadges(row.badges),
  imageUrl: homeBannerImageUrl(row.imagePath),
  imageAlt: row.imageAlt,
});

export const toAdminHomeBannerDto = (row: HomeBanner, now: Date) => ({
  ...toPublicHomeBannerDto(row),
  placement: row.placement,
  position: row.position,
  isActive: row.isActive,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  status: bannerStatus(row, now),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export type PublicHomeBannerDto = ReturnType<typeof toPublicHomeBannerDto>;
export type AdminHomeBannerDto = ReturnType<typeof toAdminHomeBannerDto>;
