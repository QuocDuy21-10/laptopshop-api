import {
  adminListHomeBannersQuery,
  bannerShapeIssues,
  createHomeBannerBody,
  homeBannerImageBody,
  isSafeBannerLink,
  patchHomeBannerBody,
  type BannerShape,
} from "modules/home-banners/home-banners.schema";

const shape = (over: Partial<BannerShape> = {}): BannerShape => ({
  placement: "HERO",
  ctaText: null,
  linkUrl: null,
  secondaryCtaText: null,
  secondaryLinkUrl: null,
  badges: [],
  imagePath: null,
  imageAlt: null,
  startsAt: null,
  endsAt: null,
  ...over,
});

describe("isSafeBannerLink", () => {
  it("accepts internal paths and https urls", () => {
    expect(isSafeBannerLink("/products?target=GAMING")).toBe(true);
    expect(isSafeBannerLink("/")).toBe(true);
    expect(isSafeBannerLink("https://example.com/sale")).toBe(true);
  });

  it("rejects dangerous or ambiguous links", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "http://example.com",
      "https://",
      "products",
      "/a b",
      "/a\nb",
      "",
    ]) {
      expect(isSafeBannerLink(bad)).toBe(false);
    }
  });
});

describe("bannerShapeIssues", () => {
  it("accepts a minimal HERO and SIDE", () => {
    expect(bannerShapeIssues(shape())).toEqual([]);
    expect(bannerShapeIssues(shape({ placement: "SIDE", linkUrl: "/products" }))).toEqual([]);
  });

  it("requires HERO cta text and link together", () => {
    expect(bannerShapeIssues(shape({ ctaText: "Xem ngay" })).map((i) => i.path)).toEqual([
      "ctaText",
    ]);
    expect(bannerShapeIssues(shape({ linkUrl: "/products" })).map((i) => i.path)).toEqual([
      "ctaText",
    ]);
    expect(bannerShapeIssues(shape({ secondaryLinkUrl: "/compare" })).map((i) => i.path)).toEqual([
      "secondaryCtaText",
    ]);
  });

  it("rejects HERO-only fields on SIDE", () => {
    const paths = bannerShapeIssues(
      shape({
        placement: "SIDE",
        ctaText: "x",
        secondaryCtaText: "y",
        secondaryLinkUrl: "/a",
        badges: ["Pin 18 giờ"],
      }),
    ).map((i) => i.path);
    expect(paths).toEqual(["ctaText", "secondaryCtaText", "secondaryLinkUrl", "badges"]);
  });

  it("requires imageAlt when there is an image", () => {
    expect(bannerShapeIssues(shape({ imagePath: "a.png" })).map((i) => i.path)).toEqual([
      "imageAlt",
    ]);
    expect(bannerShapeIssues(shape({ imagePath: "a.png", imageAlt: "Laptop gaming" }))).toEqual([]);
  });

  it("requires endsAt after startsAt", () => {
    const a = new Date("2026-11-01T00:00:00Z");
    expect(bannerShapeIssues(shape({ startsAt: a, endsAt: a })).map((i) => i.path)).toEqual([
      "endsAt",
    ]);
    expect(
      bannerShapeIssues(shape({ startsAt: a, endsAt: new Date("2026-11-02T00:00:00Z") })),
    ).toEqual([]);
  });
});

describe("createHomeBannerBody", () => {
  it("accepts a minimal body and trims text", () => {
    const body = createHomeBannerBody.parse({ placement: "HERO", title: "  Gaming 2026  " });
    expect(body.title).toBe("Gaming 2026");
  });

  it("turns blank optional text into null and coerces dates", () => {
    const body = createHomeBannerBody.parse({
      placement: "SIDE",
      title: "Sinh viên",
      description: "   ",
      linkUrl: "/products",
      startsAt: "2026-11-01T00:00:00.000Z",
    });
    expect(body.description).toBeNull();
    expect(body.startsAt).toEqual(new Date("2026-11-01T00:00:00.000Z"));
  });

  it("rejects a missing title, unknown keys and imageAlt", () => {
    expect(() => createHomeBannerBody.parse({ placement: "HERO" })).toThrow();
    expect(() => createHomeBannerBody.parse({ placement: "HERO", title: "a", foo: 1 })).toThrow();
    expect(() =>
      createHomeBannerBody.parse({ placement: "HERO", title: "a", imageAlt: "x" }),
    ).toThrow();
  });

  it("enforces length limits, badge limits and link rules", () => {
    const base = { placement: "HERO", title: "a" };
    expect(() => createHomeBannerBody.parse({ ...base, title: "x".repeat(81) })).toThrow();
    expect(() => createHomeBannerBody.parse({ ...base, badges: ["a", "b", "c"] })).toThrow();
    expect(() => createHomeBannerBody.parse({ ...base, badges: ["x".repeat(41)] })).toThrow();
    expect(() =>
      createHomeBannerBody.parse({ ...base, ctaText: "Xem", linkUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(() => createHomeBannerBody.parse({ ...base, position: 10_000 })).toThrow();
  });

  it("applies the placement shape rules", () => {
    expect(() =>
      createHomeBannerBody.parse({ placement: "SIDE", title: "a", badges: ["x"] }),
    ).toThrow();
    expect(() =>
      createHomeBannerBody.parse({ placement: "HERO", title: "a", ctaText: "Xem" }),
    ).toThrow();
    expect(() =>
      createHomeBannerBody.parse({
        placement: "HERO",
        title: "a",
        startsAt: "2026-11-02T00:00:00Z",
        endsAt: "2026-11-01T00:00:00Z",
      }),
    ).toThrow();
  });
});

describe("patchHomeBannerBody", () => {
  it("allows partial updates and null to clear a field", () => {
    expect(patchHomeBannerBody.parse({ isActive: true })).toEqual({ isActive: true });
    expect(patchHomeBannerBody.parse({ eyebrow: null, startsAt: null }).startsAt).toBeNull();
  });

  it("rejects placement changes and unknown keys", () => {
    expect(() => patchHomeBannerBody.parse({ placement: "SIDE" })).toThrow();
    expect(() => patchHomeBannerBody.parse({ imagePath: "x.png" })).toThrow();
  });

  it("rejects an empty title", () => {
    expect(() => patchHomeBannerBody.parse({ title: " " })).toThrow();
  });
});

describe("other schemas", () => {
  it("homeBannerImageBody accepts an optional alt", () => {
    expect(homeBannerImageBody.parse({})).toEqual({});
    expect(homeBannerImageBody.parse({ imageAlt: " Laptop " }).imageAlt).toBe("Laptop");
    expect(() => homeBannerImageBody.parse({ imageAlt: "x".repeat(121) })).toThrow();
    expect(() => homeBannerImageBody.parse({ imageAlt: " " })).toThrow();
  });

  it("adminListHomeBannersQuery filters by placement", () => {
    expect(adminListHomeBannersQuery.parse({}).placement).toBeUndefined();
    expect(adminListHomeBannersQuery.parse({ placement: "SIDE" }).placement).toBe("SIDE");
    expect(() => adminListHomeBannersQuery.parse({ placement: "FOOTER" })).toThrow();
  });
});
