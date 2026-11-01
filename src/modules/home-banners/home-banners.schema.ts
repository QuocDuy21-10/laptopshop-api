import { z } from "zod";

export const HOME_BANNER_PLACEMENTS = ["HERO", "SIDE"] as const;
export type HomeBannerPlacementValue = (typeof HOME_BANNER_PLACEMENTS)[number];

const hasUnsafeChars = (value: string) =>
  [...value].some((char) => char.trim() === "" || char.charCodeAt(0) < 32 || char === "\u007f");

// internal path or https only: blocks javascript:/data: URLs and protocol-relative redirects (// and /\)
export const isSafeBannerLink = (value: string): boolean => {
  if (value === "" || value.includes("\\") || hasUnsafeChars(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (!value.startsWith("https://")) return false;
  try {
    return new URL(value).hostname !== "";
  } catch {
    return false;
  }
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

const optionalLink = z
  .string()
  .trim()
  .max(255)
  .transform((value) => value || null)
  .refine((value) => value === null || isSafeBannerLink(value), {
    message: "Link must be an internal path starting with / or an https:// URL",
  })
  .nullable()
  .optional();

const date = z.coerce.date().nullable().optional();

const bannerFields = z.object({
  eyebrow: optionalText(60),
  title: z.string().trim().min(1).max(80),
  highlight: optionalText(80),
  description: optionalText(200),
  ctaText: optionalText(30),
  linkUrl: optionalLink,
  secondaryCtaText: optionalText(30),
  secondaryLinkUrl: optionalLink,
  badges: z.array(z.string().trim().min(1).max(40)).max(2),
  imageAlt: optionalText(120),
  position: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
  startsAt: date,
  endsAt: date,
});

export type BannerShape = {
  placement: HomeBannerPlacementValue;
  ctaText: string | null;
  linkUrl: string | null;
  secondaryCtaText: string | null;
  secondaryLinkUrl: string | null;
  badges: string[];
  imagePath: string | null;
  imageAlt: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};
export type ShapeIssue = { path: string; message: string };

// one rule set for create (Zod) and patch (service merges stored + new values, then re-checks)
export const bannerShapeIssues = (banner: BannerShape): ShapeIssue[] => {
  const issues: ShapeIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (banner.placement === "HERO") {
    if ((banner.ctaText === null) !== (banner.linkUrl === null))
      add("ctaText", "ctaText and linkUrl must be set together");
    if ((banner.secondaryCtaText === null) !== (banner.secondaryLinkUrl === null))
      add("secondaryCtaText", "secondaryCtaText and secondaryLinkUrl must be set together");
  } else {
    for (const key of ["ctaText", "secondaryCtaText", "secondaryLinkUrl"] as const)
      if (banner[key] !== null) add(key, "Not allowed for SIDE banners");
    if (banner.badges.length > 0) add("badges", "Not allowed for SIDE banners");
  }
  if (banner.imagePath !== null && banner.imageAlt === null)
    add("imageAlt", "imageAlt is required when the banner has an image");
  if (banner.startsAt && banner.endsAt && banner.endsAt <= banner.startsAt)
    add("endsAt", "endsAt must be after startsAt");
  return issues;
};

export const createHomeBannerBody = bannerFields
  .omit({ imageAlt: true })
  .partial()
  .extend({ placement: z.enum(HOME_BANNER_PLACEMENTS), title: bannerFields.shape.title })
  .strict()
  .superRefine((body, ctx) => {
    const issues = bannerShapeIssues({
      placement: body.placement,
      ctaText: body.ctaText ?? null,
      linkUrl: body.linkUrl ?? null,
      secondaryCtaText: body.secondaryCtaText ?? null,
      secondaryLinkUrl: body.secondaryLinkUrl ?? null,
      badges: body.badges ?? [],
      imagePath: null,
      imageAlt: null,
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
    });
    for (const issue of issues)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
  });
export type CreateHomeBannerBody = z.infer<typeof createHomeBannerBody>;

export const patchHomeBannerBody = bannerFields.partial().strict();
export type PatchHomeBannerBody = z.infer<typeof patchHomeBannerBody>;

export const homeBannerImageBody = z.object({
  imageAlt: z.string().trim().min(1).max(120).optional(),
});
export type HomeBannerImageBody = z.infer<typeof homeBannerImageBody>;

export const adminListHomeBannersQuery = z.object({
  placement: z.enum(HOME_BANNER_PLACEMENTS).optional(),
});
export type AdminListHomeBannersQuery = z.infer<typeof adminListHomeBannersQuery>;
