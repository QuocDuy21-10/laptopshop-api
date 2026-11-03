import type { Prisma } from "@prisma/client";

import type { DemoProduct, WithId } from "scripts/demo-seed/types";
import { DAY, HOUR, earlier, shift, type Rng } from "scripts/demo-seed/random";
import type { CouponInput, ResolvedPromotion } from "modules/promotions/promotions.types";
import { automaticDiscountPerUnit } from "modules/promotions/promotion-discount";

type PromotionState = "DRAFT" | "ACTIVE" | "ENDED";
type PromotionWindow = { startsAt: Date; endsAt: Date; state: PromotionState };

export type DemoCoupon = CouponInput &
  PromotionWindow & { maxUses: number | null; maxUsesPerUser: number; isPublic: boolean };

export type DemoAutomatic = PromotionWindow & {
  id: number;
  name: string;
  discountKind: "PERCENT" | "FIXED";
  discountValue: number;
  priority: number;
  stackableWithCoupon: boolean;
  pricingVersion: number;
  productIds: number[];
};

export type DemoFlashSale = DemoAutomatic & {
  quotas: Map<number, { totalQuota: number; maxUnitsPerUser: number }>;
  showRemainingQuota: boolean;
};

export type PromotionsResult = {
  coupons: DemoCoupon[];
  automatics: DemoAutomatic[];
  flashSales: DemoFlashSale[];
  promotions: WithId<Prisma.PromotionCreateManyInput>[];
  couponPolicies: Prisma.CouponPolicyCreateManyInput[];
  automaticPromotionPolicies: Prisma.AutomaticPromotionPolicyCreateManyInput[];
  flashSalePolicies: Prisma.FlashSalePolicyCreateManyInput[];
  promotionProducts: Prisma.PromotionProductCreateManyInput[];
  flashSaleProductQuotas: Prisma.FlashSaleProductQuotaCreateManyInput[];
};

// ENDED promotions still applied to orders placed inside their window
const isLive = (window: PromotionWindow, at: Date) =>
  window.state !== "DRAFT" && window.startsAt <= at && at < window.endsAt;

export const automaticAt = (automatics: DemoAutomatic[], productId: number, at: Date) =>
  automatics.find((a) => isLive(a, at) && a.productIds.includes(productId)) ?? null;

export const flashSaleAt = (flashSales: DemoFlashSale[], productId: number, at: Date) =>
  flashSales.find((sale) => isLive(sale, at) && sale.quotas.has(productId)) ?? null;

export const couponsAt = (coupons: DemoCoupon[], at: Date) => coupons.filter((c) => isLive(c, at));

const promotionFields = (p: DemoAutomatic) => ({
  id: p.id,
  name: p.name,
  discountKind: p.discountKind,
  discountValue: p.discountValue,
  priority: p.priority,
  stackableWithCoupon: p.stackableWithCoupon,
  pricingVersion: p.pricingVersion,
  startsAt: p.startsAt,
  endsAt: p.endsAt,
});

export const resolveAutomatic = (
  promotion: DemoAutomatic,
  listPrice: number,
): ResolvedPromotion => ({
  ...promotionFields(promotion),
  kind: "AUTOMATIC",
  unitDiscount: automaticDiscountPerUnit(promotion, listPrice),
});

export const resolveFlashSale = (
  sale: DemoFlashSale,
  productId: number,
  listPrice: number,
  claimed: number,
  userClaimed: number,
): ResolvedPromotion => {
  const quota = sale.quotas.get(productId);
  if (!quota) throw new Error(`demo seed: product ${productId} is not in flash sale ${sale.id}`);
  return {
    ...promotionFields(sale),
    kind: "FLASH_SALE",
    unitDiscount: automaticDiscountPerUnit(sale, listPrice),
    totalQuota: quota.totalQuota,
    claimedUnits: claimed,
    remainingQuota: quota.totalQuota - claimed,
    maxUnitsPerUser: quota.maxUnitsPerUser,
    showRemainingQuota: sale.showRemainingQuota,
    userClaimedUnits: userClaimed,
    userRemainingQuota: quota.maxUnitsPerUser - userClaimed,
  };
};

export const buildPromotions = (
  rng: Rng,
  now: Date,
  products: DemoProduct[],
  adminId: number,
): PromotionsResult => {
  const day = (n: number) => shift(now, n * DAY);
  const active = products.filter((p) => p.isActive);
  const ids = (list: DemoProduct[]) => list.map((p) => p.id);
  const flashPool = rng.shuffle(
    active.filter(
      (p) => p.endState === "NORMAL" && p.factory !== "DELL" && p.target !== "SINHVIEN-VANPHONG",
    ),
  );
  const flashNow = flashPool.slice(0, 5);
  const flashNext = flashPool.slice(5, 8);
  const inFlash = new Set(ids([...flashNow, ...flashNext]));
  const free = active.filter((p) => !inFlash.has(p.id));

  const coupons: DemoCoupon[] = [
    {
      id: 1,
      code: "DEMO10",
      name: "Giảm 10% đơn từ 15 triệu",
      scope: "ORDER",
      discountKind: "PERCENT",
      discountValue: 10,
      minOrderValue: 15_000_000,
      maxDiscount: 2_000_000,
      pricingVersion: 1,
      targetProductIds: [],
      startsAt: day(-150),
      endsAt: day(30),
      state: "ACTIVE",
      maxUses: 500,
      maxUsesPerUser: 3,
      isPublic: true,
    },
    {
      id: 2,
      code: "GAMING500K",
      name: "Giảm 500.000đ laptop gaming",
      scope: "PRODUCT",
      discountKind: "FIXED",
      discountValue: 500_000,
      minOrderValue: 0,
      maxDiscount: null,
      pricingVersion: 1,
      targetProductIds: ids(active.filter((p) => p.target === "GAMING")),
      startsAt: day(-45),
      endsAt: day(15),
      state: "ACTIVE",
      maxUses: null,
      maxUsesPerUser: 1,
      isPublic: true,
    },
    {
      id: 3,
      code: "SUMMER15",
      name: "Hè rực rỡ giảm 15%",
      scope: "ORDER",
      discountKind: "PERCENT",
      discountValue: 15,
      minOrderValue: 20_000_000,
      maxDiscount: 3_000_000,
      pricingVersion: 1,
      targetProductIds: [],
      startsAt: day(-170),
      endsAt: day(-120),
      state: "ENDED",
      maxUses: 100,
      maxUsesPerUser: 1,
      isPublic: true,
    },
    {
      id: 4,
      code: "TET2027",
      name: "Lì xì Tết 1.000.000đ",
      scope: "ORDER",
      discountKind: "FIXED",
      discountValue: 1_000_000,
      minOrderValue: 25_000_000,
      maxDiscount: null,
      pricingVersion: 1,
      targetProductIds: [],
      startsAt: day(60),
      endsAt: day(90),
      state: "DRAFT",
      maxUses: 300,
      maxUsesPerUser: 1,
      isPublic: false,
    },
  ];
  const automatics: DemoAutomatic[] = [
    {
      id: 5,
      name: "Ưu đãi Dell cho doanh nghiệp",
      discountKind: "PERCENT",
      discountValue: 5,
      priority: 10,
      stackableWithCoupon: true,
      pricingVersion: 1,
      startsAt: day(-30),
      endsAt: day(30),
      state: "ACTIVE",
      productIds: ids(free.filter((p) => p.factory === "DELL")),
    },
    {
      id: 6,
      name: "Back to school",
      discountKind: "FIXED",
      discountValue: 1_000_000,
      priority: 5,
      stackableWithCoupon: false,
      pricingVersion: 1,
      startsAt: day(-60),
      endsAt: day(20),
      state: "ACTIVE",
      productIds: ids(free.filter((p) => p.target === "SINHVIEN-VANPHONG" && p.factory !== "DELL")),
    },
    {
      id: 7,
      name: "Sale giữa năm",
      discountKind: "PERCENT",
      discountValue: 8,
      priority: 5,
      stackableWithCoupon: false,
      pricingVersion: 1,
      startsAt: day(-130),
      endsAt: day(-100),
      state: "ENDED",
      productIds: ids(active.filter((p) => p.target === "MONG-NHE")),
    },
  ];
  const quotasFor = (list: DemoProduct[], range: [number, number], maxUnitsPerUser: number) =>
    new Map(list.map((p) => [p.id, { totalQuota: rng.int(...range), maxUnitsPerUser }]));
  const flashSales: DemoFlashSale[] = [
    {
      id: 8,
      name: "Flash sale cuối tuần",
      discountKind: "PERCENT",
      discountValue: 15,
      priority: 100,
      stackableWithCoupon: false,
      pricingVersion: 1,
      startsAt: shift(now, -20 * HOUR),
      endsAt: day(2),
      state: "ACTIVE",
      productIds: ids(flashNow),
      quotas: quotasFor(flashNow, [12, 20], 2),
      showRemainingQuota: true,
    },
    {
      id: 9,
      name: "Flash sale tháng sau",
      discountKind: "PERCENT",
      discountValue: 20,
      priority: 100,
      stackableWithCoupon: false,
      pricingVersion: 1,
      startsAt: day(7),
      endsAt: day(8),
      state: "ACTIVE",
      productIds: ids(flashNext),
      quotas: quotasFor(flashNext, [10, 15], 1),
      showRemainingQuota: true,
    },
  ];

  const row = (
    p: {
      id: number;
      name: string;
      discountKind: "PERCENT" | "FIXED";
      discountValue: number;
    } & PromotionWindow,
    kind: "COUPON" | "AUTOMATIC" | "FLASH_SALE",
  ) => ({
    id: p.id,
    kind,
    state: p.state,
    name: p.name,
    description: `Chương trình demo: ${p.name}`,
    discountKind: p.discountKind,
    discountValue: p.discountValue,
    pricingVersion: 1,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    activatedAt: p.state === "DRAFT" ? null : earlier(p.startsAt, now),
    createdAt: shift(earlier(p.startsAt, now), -2 * DAY),
    createdById: adminId,
    updatedById: adminId,
  });

  return {
    coupons,
    automatics,
    flashSales,
    promotions: [
      ...coupons.map((c) => row(c, "COUPON")),
      ...automatics.map((a) => row(a, "AUTOMATIC")),
      ...flashSales.map((f) => row(f, "FLASH_SALE")),
    ],
    couponPolicies: coupons.map((c) => ({
      promotionId: c.id,
      code: c.code,
      scope: c.scope,
      minOrderValue: c.minOrderValue,
      maxDiscount: c.maxDiscount,
      maxUses: c.maxUses,
      // replaced in build.ts by the count of applied redemptions
      usedCount: 0,
      maxUsesPerUser: c.maxUsesPerUser,
      isPublic: c.isPublic,
    })),
    automaticPromotionPolicies: automatics.map((a) => ({
      promotionId: a.id,
      priority: a.priority,
      stackableWithCoupon: a.stackableWithCoupon,
    })),
    flashSalePolicies: flashSales.map((f) => ({
      promotionId: f.id,
      priority: f.priority,
      stackableWithCoupon: f.stackableWithCoupon,
      showRemainingQuota: f.showRemainingQuota,
    })),
    promotionProducts: [
      ...coupons.flatMap((c) =>
        c.targetProductIds.map((productId) => ({ promotionId: c.id, productId })),
      ),
      ...[...automatics, ...flashSales].flatMap((p) =>
        p.productIds.map((productId) => ({ promotionId: p.id, productId })),
      ),
    ],
    flashSaleProductQuotas: flashSales.flatMap((sale) =>
      [...sale.quotas.entries()].map(([productId, quota]) => ({
        promotionId: sale.id,
        productId,
        totalQuota: quota.totalQuota,
        // replaced in build.ts by the claimed allocations
        claimedUnits: 0,
        maxUnitsPerUser: quota.maxUnitsPerUser,
      })),
    ),
  };
};
