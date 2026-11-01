jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import fs from "fs";
import path from "path";
import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, cookieFor } from "../../helpers/auth";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const DIR = path.join("public", "images", "banner");
const admin = { Cookie: cookieFor(ADMIN) };

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  placement: "HERO",
  eyebrow: null,
  title: "Gaming 2026",
  highlight: null,
  description: null,
  ctaText: null,
  linkUrl: null,
  secondaryCtaText: null,
  secondaryLinkUrl: null,
  badges: [],
  imagePath: null,
  imageAlt: null,
  position: 0,
  isActive: false,
  startsAt: null,
  endsAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  ...over,
});

const files = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).sort() : []);
const cleanup: string[] = [];

beforeEach(resetPrisma);
afterEach(() => {
  for (const name of cleanup.splice(0)) fs.rmSync(path.join(DIR, name), { force: true });
});

describe("POST /api/v1/admin/home-banners/:id/image", () => {
  it("stores the image with the given alt and returns the admin dto", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(row());
    prismaMock.homeBanner.update.mockImplementation(async ({ data }: any) => row(data));

    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners/1/image")
      .set(admin)
      .field("imageAlt", "Laptop gaming")
      .attach("image", PNG, { filename: "hero.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toMatch(/^\/images\/banner\/[0-9a-f-]{36}\.png$/);
    expect(res.body.data.imageAlt).toBe("Laptop gaming");
    const name = path.basename(res.body.data.imageUrl);
    cleanup.push(name);
    expect(files()).toContain(name);
  });

  it("removes the previous file when the image is replaced", async () => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, "old-test.png"), PNG);
    prismaMock.homeBanner.findUnique.mockResolvedValue(
      row({ imagePath: "old-test.png", imageAlt: "Cũ" }),
    );
    prismaMock.homeBanner.update.mockImplementation(async ({ data }: any) =>
      row({ imagePath: data.imagePath, imageAlt: data.imageAlt }),
    );

    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners/1/image")
      .set(admin)
      .attach("image", PNG, { filename: "hero.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.data.imageAlt).toBe("Cũ");
    cleanup.push(path.basename(res.body.data.imageUrl), "old-test.png");
    expect(files()).not.toContain("old-test.png");
  });

  it("rejects an upload without alt text and stores nothing", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(row());
    const before = files();
    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners/1/image")
      .set(admin)
      .attach("image", PNG, { filename: "hero.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(prismaMock.homeBanner.update).not.toHaveBeenCalled();
    expect(files()).toEqual(before);
  });

  it("returns 404 for an unknown banner and stores nothing", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(null);
    const before = files();
    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners/9/image")
      .set(admin)
      .field("imageAlt", "x")
      .attach("image", PNG, { filename: "hero.png", contentType: "image/png" });
    expect(res.status).toBe(404);
    expect(files()).toEqual(before);
  });

  it("returns 400 when no file is sent", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(row());
    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners/1/image")
      .set(admin)
      .field("imageAlt", "x");
    expect(res.status).toBe(400);
  });

  it("rejects non-image bytes sent with an image MIME type", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(row());
    const before = files();
    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners/1/image")
      .set(admin)
      .field("imageAlt", "x")
      .attach("image", Buffer.from("not an image"), {
        filename: "x.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE");
    expect(files()).toEqual(before);
  });

  it("does not fail when cleaning up the old file fails", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(
      row({ imagePath: "missing-old.png", imageAlt: "Cũ" }),
    );
    prismaMock.homeBanner.update.mockImplementation(async ({ data }: any) =>
      row({ imagePath: data.imagePath, imageAlt: data.imageAlt }),
    );
    const res = await request(buildApp())
      .post("/api/v1/admin/home-banners/1/image")
      .set(admin)
      .attach("image", PNG, { filename: "hero.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    cleanup.push(path.basename(res.body.data.imageUrl));
  });
});

describe("DELETE /api/v1/admin/home-banners/:id/image", () => {
  it("clears the image and alt, and removes the file", async () => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, "to-clear-test.png"), PNG);
    prismaMock.homeBanner.findUnique.mockResolvedValue(
      row({ imagePath: "to-clear-test.png", imageAlt: "Cũ" }),
    );
    prismaMock.homeBanner.update.mockImplementation(async ({ data }: any) => row(data));

    const res = await request(buildApp()).delete("/api/v1/admin/home-banners/1/image").set(admin);

    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toBeNull();
    expect(prismaMock.homeBanner.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { imagePath: null, imageAlt: null },
    });
    cleanup.push("to-clear-test.png");
    expect(files()).not.toContain("to-clear-test.png");
  });

  it("returns 404 for an unknown banner", async () => {
    prismaMock.homeBanner.findUnique.mockResolvedValue(null);
    const res = await request(buildApp()).delete("/api/v1/admin/home-banners/9/image").set(admin);
    expect(res.status).toBe(404);
  });
});
