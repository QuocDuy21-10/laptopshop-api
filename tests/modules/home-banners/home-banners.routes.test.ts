jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  placement: "HERO",
  eyebrow: null,
  title: "Gaming 2026",
  highlight: null,
  description: null,
  ctaText: "Xem ngay",
  linkUrl: "/products",
  secondaryCtaText: null,
  secondaryLinkUrl: null,
  badges: [],
  imagePath: null,
  imageAlt: null,
  position: 0,
  isActive: true,
  startsAt: null,
  endsAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  ...over,
});

const admin = { Cookie: cookieFor(ADMIN) };

beforeEach(resetPrisma);

describe("GET /api/v1/home-banners", () => {
  it("returns active hero and side banners with limits and no internal fields", async () => {
    prismaMock.homeBanner.findMany
      .mockResolvedValueOnce([row({ id: 1 })])
      .mockResolvedValueOnce([row({ id: 2, placement: "SIDE", ctaText: null })]);

    const res = await request(buildApp()).get("/api/v1/home-banners");

    expect(res.status).toBe(200);
    expect(res.body.data.hero.map((b: { id: number }) => b.id)).toEqual([1]);
    expect(res.body.data.side.map((b: { id: number }) => b.id)).toEqual([2]);
    expect(res.body.data.hero[0]).not.toHaveProperty("isActive");
    expect(res.body.data.hero[0]).not.toHaveProperty("position");
    const [heroCall, sideCall] = prismaMock.homeBanner.findMany.mock.calls.map((c: any[]) => c[0]);
    expect(heroCall).toMatchObject({
      where: { placement: "HERO", isActive: true },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: 5,
    });
    expect(sideCall).toMatchObject({ where: { placement: "SIDE" }, take: 3 });
    expect(JSON.stringify(heroCall.where.AND)).toContain("startsAt");
    expect(JSON.stringify(heroCall.where.AND)).toContain("endsAt");
  });

  it("returns empty arrays when nothing is active", async () => {
    prismaMock.homeBanner.findMany.mockResolvedValue([]);
    const res = await request(buildApp()).get("/api/v1/home-banners");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ hero: [], side: [] });
  });
});

describe("admin /api/v1/admin/home-banners", () => {
  it("requires an admin", async () => {
    expect((await request(buildApp()).get("/api/v1/admin/home-banners")).status).toBe(401);
    const user = await request(buildApp())
      .get("/api/v1/admin/home-banners")
      .set("Cookie", cookieFor(USER));
    expect(user.status).toBe(403);
  });

  it("lists every banner with a derived status", async () => {
    prismaMock.homeBanner.findMany.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, isActive: false }),
    ]);
    const res = await request(buildApp())
      .get("/api/v1/admin/home-banners?placement=HERO")
      .set(admin);
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { status: string }) => b.status)).toEqual(["ACTIVE", "INACTIVE"]);
    expect(prismaMock.homeBanner.findMany).toHaveBeenCalledWith({
      where: { placement: "HERO" },
      orderBy: [{ placement: "asc" }, { position: "asc" }, { id: "asc" }],
    });
  });

  it("creates a banner with defaults (inactive, position 0, no badges)", async () => {
    prismaMock.homeBanner.create.mockImplementation(async ({ data }: any) => row(data));
    const res = await request(buildApp()).post("/api/v1/admin/home-banners").set(admin).send({
      placement: "SIDE",
      title: "Sinh viên",
      linkUrl: "/products?target=SINHVIEN_VANPHONG",
    });
    expect(res.status).toBe(201);
    expect(prismaMock.homeBanner.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        placement: "SIDE",
        title: "Sinh viên",
        badges: [],
        position: 0,
        isActive: false,
        startsAt: null,
        endsAt: null,
      }),
    });
  });

  it("rejects an invalid create body with 400", async () => {
    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners")
      .set(admin)
      .send({ placement: "HERO", title: "a", ctaText: "Xem", linkUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(prismaMock.homeBanner.create).not.toHaveBeenCalled();
  });

  it("returns one banner and 404 when missing", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValueOnce(row({ id: 5 }));
    const ok = await request(buildApp()).get("/api/v1/admin/home-banners/5").set(admin);
    expect(ok.status).toBe(200);
    expect(ok.body.data.id).toBe(5);

    prismaMock.homeBanner.findUnique.mockResolvedValueOnce(null);
    const missing = await request(buildApp()).get("/api/v1/admin/home-banners/6").set(admin);
    expect(missing.status).toBe(404);
  });

  it("patches only the sent fields", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(row());
    prismaMock.homeBanner.update.mockImplementation(async ({ data }: any) => row(data));
    const res = await request(buildApp())
      .patch("/api/v1/admin/home-banners/1")
      .set(admin)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(prismaMock.homeBanner.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
  });

  it("re-checks the placement rules against the merged banner on patch", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(
      row({ placement: "SIDE", ctaText: null, linkUrl: "/products" }),
    );
    const sideBadge = await request(buildApp())
      .patch("/api/v1/admin/home-banners/1")
      .set(admin)
      .send({ badges: ["x"] });
    expect(sideBadge.status).toBe(400);
    expect(sideBadge.body.error.details).toEqual([
      { path: "badges", message: "Not allowed for SIDE banners" },
    ]);

    prismaMock.homeBanner.findUnique.mockResolvedValue(row());
    const dropLink = await request(buildApp())
      .patch("/api/v1/admin/home-banners/1")
      .set(admin)
      .send({ linkUrl: null });
    expect(dropLink.status).toBe(400);
    expect(prismaMock.homeBanner.update).not.toHaveBeenCalled();
  });

  it("rejects placement changes on patch", async () => {
    const res = await request(buildApp())
      .patch("/api/v1/admin/home-banners/1")
      .set(admin)
      .send({ placement: "SIDE" });
    expect(res.status).toBe(400);
  });

  it("deletes a banner and returns 204; 404 when missing", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValueOnce(row());
    prismaMock.homeBanner.delete.mockResolvedValue(row());
    const ok = await request(buildApp()).delete("/api/v1/admin/home-banners/1").set(admin);
    expect(ok.status).toBe(204);
    expect(prismaMock.homeBanner.delete).toHaveBeenCalledWith({ where: { id: 1 } });

    prismaMock.homeBanner.findUnique.mockResolvedValueOnce(null);
    const missing = await request(buildApp()).delete("/api/v1/admin/home-banners/2").set(admin);
    expect(missing.status).toBe(404);
  });

  it("rejects a non-numeric id", async () => {
    const res = await request(buildApp()).get("/api/v1/admin/home-banners/abc").set(admin);
    expect(res.status).toBe(400);
  });
});
