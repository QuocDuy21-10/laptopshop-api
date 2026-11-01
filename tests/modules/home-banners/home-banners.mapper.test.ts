import {
  bannerStatus,
  homeBannerImageUrl,
  toAdminHomeBannerDto,
  toBadges,
  toPublicHomeBannerDto,
} from "modules/home-banners/home-banners.mapper";

const now = new Date("2026-11-10T00:00:00.000Z");
const row = {
  id: 7,
  placement: "HERO" as const,
  eyebrow: "Mới",
  title: "Gaming 2026",
  highlight: null,
  description: null,
  ctaText: "Xem ngay",
  linkUrl: "/products?target=GAMING",
  secondaryCtaText: null,
  secondaryLinkUrl: null,
  badges: ["RTX 50"],
  imagePath: "a.png",
  imageAlt: "Laptop",
  position: 2,
  isActive: true,
  startsAt: null,
  endsAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-02T00:00:00.000Z"),
};

describe("home banner mapper", () => {
  it("builds the image url", () => {
    expect(homeBannerImageUrl("a.png")).toBe("/images/banner/a.png");
    expect(homeBannerImageUrl(null)).toBeNull();
  });

  it("keeps only string badges", () => {
    expect(toBadges(["a", 1, null, "b"] as never)).toEqual(["a", "b"]);
    expect(toBadges({ x: 1 } as never)).toEqual([]);
  });

  it("derives the status", () => {
    const on = { isActive: true, startsAt: null, endsAt: null };
    expect(bannerStatus(on, now)).toBe("ACTIVE");
    expect(bannerStatus({ ...on, isActive: false }, now)).toBe("INACTIVE");
    expect(bannerStatus({ ...on, startsAt: new Date("2026-11-11T00:00:00Z") }, now)).toBe(
      "SCHEDULED",
    );
    expect(bannerStatus({ ...on, endsAt: new Date("2026-11-10T00:00:00Z") }, now)).toBe("EXPIRED");
    expect(
      bannerStatus(
        { isActive: false, startsAt: null, endsAt: new Date("2026-11-01T00:00:00Z") },
        now,
      ),
    ).toBe("INACTIVE");
  });

  it("does not leak internal fields in the public dto", () => {
    expect(toPublicHomeBannerDto(row)).toEqual({
      id: 7,
      eyebrow: "Mới",
      title: "Gaming 2026",
      highlight: null,
      description: null,
      ctaText: "Xem ngay",
      linkUrl: "/products?target=GAMING",
      secondaryCtaText: null,
      secondaryLinkUrl: null,
      badges: ["RTX 50"],
      imageUrl: "/images/banner/a.png",
      imageAlt: "Laptop",
    });
  });

  it("adds management fields to the admin dto", () => {
    expect(toAdminHomeBannerDto(row, now)).toMatchObject({
      id: 7,
      placement: "HERO",
      position: 2,
      isActive: true,
      status: "ACTIVE",
      imageUrl: "/images/banner/a.png",
    });
  });
});
