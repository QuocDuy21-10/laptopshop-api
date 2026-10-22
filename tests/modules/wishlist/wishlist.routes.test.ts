jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/promotions/promotion-resolver", () => ({
  resolveAutomaticPromotions: jest.fn().mockResolvedValue(new Map()),
}));

import request from "supertest";
import { resolveAutomaticPromotions } from "modules/promotions/promotion-resolver";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

const product = {
  id: 3,
  name: "Dell XPS",
  price: 1_000,
  image: "dell.png",
  detailDesc: "detail",
  shortDesc: "short",
  quantity: 5,
  sold: 0,
  factory: "DELL",
  target: "MONG_NHE",
  isActive: true,
  cpu: null,
  cpuBrand: null,
  gpu: null,
  gpuBrand: null,
  gpuType: null,
  ramGb: null,
  storageGb: null,
  screenSizeInch: null,
  screenResolution: null,
  resolutionTier: null,
  panelType: null,
  refreshRateHz: null,
  batteryWh: null,
  weightGrams: null,
  warrantyMonths: null,
};

const row = {
  id: 7,
  userId: USER.id,
  productId: product.id,
  alertMode: null,
  targetPrice: null,
  referencePrice: null,
  lastAlertMode: null,
  lastAlertedPrice: null,
  lastAlertedAt: null,
  createdAt: new Date("2026-10-22T00:00:00.000Z"),
  updatedAt: new Date("2026-10-22T00:00:00.000Z"),
  product,
};

const auth = () => cookieFor(USER);

beforeEach(() => {
  resetPrisma();
  (resolveAutomaticPromotions as jest.Mock).mockResolvedValue(new Map());
});

describe("Wishlist authentication and reads", () => {
  it("requires authentication for every wishlist endpoint", async () => {
    const app = buildApp();
    await expect(request(app).get("/api/v1/wishlist")).resolves.toHaveProperty("status", 401);
    await expect(request(app).get("/api/v1/wishlist/summary")).resolves.toHaveProperty(
      "status",
      401,
    );
    await expect(request(app).get("/api/v1/wishlist/status?productIds=1")).resolves.toHaveProperty(
      "status",
      401,
    );
    await expect(request(app).put("/api/v1/wishlist/items/1")).resolves.toHaveProperty(
      "status",
      401,
    );
    await expect(
      request(app).patch("/api/v1/wishlist/items/1").send({ mode: null }),
    ).resolves.toHaveProperty("status", 401);
    await expect(request(app).delete("/api/v1/wishlist/items/1")).resolves.toHaveProperty(
      "status",
      401,
    );
  });

  it("lists the caller's items with live priced product DTOs", async () => {
    prismaMock.wishlistItem.count.mockResolvedValue(1);
    prismaMock.wishlistItem.findMany.mockResolvedValue([row]);
    (resolveAutomaticPromotions as jest.Mock).mockResolvedValue(
      new Map([
        [
          product.id,
          {
            id: 12,
            name: "Automatic",
            startsAt: new Date(),
            endsAt: new Date(),
            unitDiscount: 100,
          },
        ],
      ]),
    );

    const res = await request(buildApp()).get("/api/v1/wishlist").set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      id: row.id,
      productId: product.id,
      product: { id: product.id, salePrice: 900, productDiscountAmount: 100 },
    });
    expect(prismaMock.wishlistItem.findMany.mock.calls[0][0].where).toMatchObject({
      userId: USER.id,
    });
    expect(res.body.data[0].product.password).toBeUndefined();
  });

  it("scopes summary and status to the authenticated user", async () => {
    prismaMock.wishlistItem.count.mockResolvedValue(4);
    prismaMock.wishlistItem.findMany.mockResolvedValue([{ productId: 2 }]);

    const summary = await request(buildApp()).get("/api/v1/wishlist/summary").set("Cookie", auth());
    const status = await request(buildApp())
      .get("/api/v1/wishlist/status?productIds=1,2,3")
      .set("Cookie", auth());

    expect(summary.body).toEqual({ data: { itemCount: 4 } });
    expect(status.body.data).toEqual([
      { productId: 1, isWishlisted: false },
      { productId: 2, isWishlisted: true },
      { productId: 3, isWishlisted: false },
    ]);
    expect(prismaMock.wishlistItem.count.mock.calls[0][0].where).toEqual({ userId: USER.id });
    expect(prismaMock.wishlistItem.findMany.mock.calls[0][0].where).toEqual({
      userId: USER.id,
      productId: { in: [1, 2, 3] },
    });
  });

  it("rejects duplicate status ids and batches larger than fifty", async () => {
    await expect(
      request(buildApp()).get("/api/v1/wishlist/status?productIds=1,1").set("Cookie", auth()),
    ).resolves.toHaveProperty("status", 400);
    await expect(
      request(buildApp())
        .get(
          `/api/v1/wishlist/status?productIds=${Array.from({ length: 51 }, (_, i) => i + 1).join(",")}`,
        )
        .set("Cookie", auth()),
    ).resolves.toHaveProperty("status", 400);
  });
});

describe("Wishlist mutations", () => {
  it("returns the existing item without resetting its alert configuration", async () => {
    const configured = { ...row, alertMode: "PERCENT_DROP", referencePrice: 900 };
    prismaMock.wishlistItem.findUnique.mockResolvedValue(configured);

    const res = await request(buildApp())
      .put(`/api/v1/wishlist/items/${product.id}`)
      .set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ alertMode: "PERCENT_DROP", referencePrice: 900 });
    expect(prismaMock.wishlistItem.create).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown product", async () => {
    prismaMock.wishlistItem.findUnique.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue(null);

    const res = await request(buildApp()).put("/api/v1/wishlist/items/999").set("Cookie", auth());

    expect(res.status).toBe(404);
  });

  it("returns PRODUCT_UNAVAILABLE for an inactive product", async () => {
    prismaMock.wishlistItem.findUnique.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue({ ...product, isActive: false });

    const res = await request(buildApp())
      .put(`/api/v1/wishlist/items/${product.id}`)
      .set("Cookie", auth());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("allows an out-of-stock product to be wishlisted", async () => {
    prismaMock.wishlistItem.findUnique.mockResolvedValue(null);
    prismaMock.product.findUnique.mockResolvedValue({ ...product, quantity: 0 });
    prismaMock.wishlistItem.count.mockResolvedValue(0);
    prismaMock.wishlistItem.create.mockResolvedValue({
      ...row,
      product: { ...product, quantity: 0 },
    });

    const res = await request(buildApp())
      .put(`/api/v1/wishlist/items/${product.id}`)
      .set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.data.product.quantity).toBe(0);
  });

  it("validates target price against the current effective price", async () => {
    prismaMock.wishlistItem.findFirst.mockResolvedValue(row);
    prismaMock.product.findUnique.mockResolvedValue(product);
    (resolveAutomaticPromotions as jest.Mock).mockResolvedValue(new Map());

    const res = await request(buildApp())
      .patch(`/api/v1/wishlist/items/${product.id}`)
      .set("Cookie", auth())
      .send({ mode: "TARGET_PRICE", targetPrice: product.price });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TARGET_PRICE");
    expect(prismaMock.wishlistItem.update).not.toHaveBeenCalled();
  });

  it("accepts disabling the alert with the discriminated union", async () => {
    prismaMock.wishlistItem.findFirst.mockResolvedValue({
      ...row,
      alertMode: "TARGET_PRICE",
      targetPrice: 800,
    });
    prismaMock.wishlistItem.update.mockResolvedValue({ ...row, lastAlertMode: "TARGET_PRICE" });

    const res = await request(buildApp())
      .patch(`/api/v1/wishlist/items/${product.id}`)
      .set("Cookie", auth())
      .send({ mode: null });

    expect(res.status).toBe(200);
    expect(prismaMock.wishlistItem.update.mock.calls[0][0].data).toMatchObject({
      alertMode: null,
      targetPrice: null,
      referencePrice: null,
    });
  });
});

describe("Wishlist delete", () => {
  it("is idempotent and scopes deletion to the caller", async () => {
    prismaMock.wishlistItem.deleteMany.mockResolvedValue({ count: 0 });
    const absent = await request(buildApp())
      .delete(`/api/v1/wishlist/items/${product.id}`)
      .set("Cookie", auth());
    expect(absent.status).toBe(204);
    expect(prismaMock.wishlistItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER.id, productId: product.id },
    });
  });
});
