import {
  createPromotionBody,
  transitionPromotionBody,
  updatePromotionBody,
} from "modules/promotions/promotions.schema";

const base = {
  kind: "COUPON" as const,
  name: "Welcome",
  discountKind: "PERCENT" as const,
  discountValue: 10,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-11-01T00:00:00.000Z",
  coupon: {
    code: " welcome10 ",
    scope: "ORDER" as const,
    minOrderValue: 0,
    maxUsesPerUser: 1,
    isPublic: false,
  },
};

describe("promotion schemas", () => {
  it("normalizes an uppercase coupon code and accepts a valid coupon draft", () => {
    const result = createPromotionBody.parse(base);
    expect(result.coupon?.code).toBe("WELCOME10");
  });

  it("rejects duplicate target products", () => {
    expect(
      createPromotionBody.safeParse({
        ...base,
        coupon: { ...base.coupon, scope: "PRODUCT", targetProductIds: [3, 3] },
      }).success,
    ).toBe(false);
    expect(updatePromotionBody.safeParse({ automatic: { targetProductIds: [4, 4] } }).success).toBe(
      false,
    );
  });

  it("rejects invalid coupon code, percent and fixed values", () => {
    expect(
      createPromotionBody.safeParse({ ...base, coupon: { ...base.coupon, code: "bad code" } })
        .success,
    ).toBe(false);
    expect(createPromotionBody.safeParse({ ...base, discountValue: 101 }).success).toBe(false);
    expect(
      createPromotionBody.safeParse({ ...base, discountKind: "FIXED", discountValue: 0 }).success,
    ).toBe(false);
  });

  it("rejects reversed dates, invalid scope targets and bad usage bounds", () => {
    expect(createPromotionBody.safeParse({ ...base, startsAt: base.endsAt }).success).toBe(false);
    expect(
      createPromotionBody.safeParse({
        ...base,
        coupon: { ...base.coupon, scope: "ORDER", targetProductIds: [1] },
      }).success,
    ).toBe(false);
    expect(
      createPromotionBody.safeParse({ ...base, coupon: { ...base.coupon, maxUses: 0 } }).success,
    ).toBe(false);
  });

  it("accepts automatic product targeting and rejects an empty patch", () => {
    const automatic = createPromotionBody.parse({
      ...base,
      kind: "AUTOMATIC",
      coupon: undefined,
      automatic: { priority: 2, stackableWithCoupon: true, targetProductIds: [1, 2] },
    });
    expect(automatic.automatic?.targetProductIds).toEqual([1, 2]);
    expect(updatePromotionBody.safeParse({}).success).toBe(false);
  });

  it("validates Flash Sale policy, unique quota products and per-user bounds", () => {
    const flashSale = {
      ...base,
      kind: "FLASH_SALE" as const,
      coupon: undefined,
      automatic: undefined,
      flashSale: {
        priority: 10,
        stackableWithCoupon: false,
        showRemainingQuota: true,
        items: [{ productId: "1", totalQuota: "10", maxUnitsPerUser: "2" }],
      },
    };
    const parsed = createPromotionBody.parse(flashSale);
    expect(parsed.flashSale?.items[0]).toMatchObject({
      productId: 1,
      totalQuota: 10,
      maxUnitsPerUser: 2,
    });
    expect(
      createPromotionBody.safeParse({
        ...flashSale,
        flashSale: {
          ...flashSale.flashSale,
          items: [
            { productId: "1", totalQuota: "10", maxUnitsPerUser: "2" },
            { productId: 1, totalQuota: 10, maxUnitsPerUser: 2 },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      createPromotionBody.safeParse({
        ...flashSale,
        flashSale: {
          ...flashSale.flashSale,
          items: [{ productId: 1, totalQuota: 0, maxUnitsPerUser: 1 }],
        },
      }).success,
    ).toBe(false);
    expect(
      createPromotionBody.safeParse({
        ...flashSale,
        flashSale: {
          ...flashSale.flashSale,
          items: [{ productId: 1, totalQuota: 2, maxUnitsPerUser: 3 }],
        },
        automatic: { priority: 1, stackableWithCoupon: false, targetProductIds: [1] },
      }).success,
    ).toBe(false);
  });

  it("rejects integers that do not fit the INT columns", () => {
    const tooBig = 2_147_483_648;
    expect(
      createPromotionBody.safeParse({ ...base, discountKind: "FIXED", discountValue: tooBig })
        .success,
    ).toBe(false);
    for (const field of ["minOrderValue", "maxDiscount", "maxUses", "maxUsesPerUser"]) {
      expect(
        createPromotionBody.safeParse({ ...base, coupon: { ...base.coupon, [field]: tooBig } })
          .success,
      ).toBe(false);
    }
    expect(
      createPromotionBody.safeParse({
        ...base,
        kind: "AUTOMATIC",
        coupon: undefined,
        automatic: { targetProductIds: [tooBig] },
      }).success,
    ).toBe(false);
    for (const item of [
      { productId: tooBig, totalQuota: 1, maxUnitsPerUser: 1 },
      { productId: 1, totalQuota: tooBig, maxUnitsPerUser: 1 },
    ]) {
      expect(
        createPromotionBody.safeParse({
          ...base,
          kind: "FLASH_SALE",
          coupon: undefined,
          flashSale: { items: [item] },
        }).success,
      ).toBe(false);
    }
    expect(updatePromotionBody.safeParse({ discountValue: tooBig }).success).toBe(false);
  });

  it("only accepts known lifecycle actions", () => {
    expect(transitionPromotionBody.safeParse({ action: "ACTIVATE" }).success).toBe(true);
    expect(transitionPromotionBody.safeParse({ action: "DELETE" }).success).toBe(false);
  });
});
