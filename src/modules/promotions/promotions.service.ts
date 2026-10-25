import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import {
  AdminPromotionQuery,
  CreatePromotionBody,
  PromotionRedemptionQuery,
  FlashSaleAllocationQuery,
  UpdatePromotionBody,
} from "modules/promotions/promotions.schema";
import {
  flashSaleAllocationInclude,
  promotionInclude,
  redemptionInclude,
} from "modules/promotions/promotions.repository";
import {
  toPromotionDetailDto,
  toPromotionSummaryDto,
  toRedemptionDto,
  toFlashSaleAllocationDto,
} from "modules/promotions/promotions.mapper";
import { calculatePromotionPricing } from "modules/promotions/promotion-pricing";
import { createPricingFingerprint } from "modules/promotions/promotion-fingerprint";
import {
  resolveProductPromotions,
  type PrismaClientLike,
} from "modules/promotions/promotion-resolver";
import { requestPricingReevaluation } from "modules/price-alerts/pricing-events";
import type {
  PricingLineInput,
  PricingQuoteDto,
  ResolvedCoupon,
} from "modules/promotions/promotions.types";

const pricingFields = new Set([
  "kind",
  "discountKind",
  "discountValue",
  "startsAt",
  "endsAt",
  "coupon",
  "automatic",
  "targetProductIds",
]);

const promotionWhere = (query: AdminPromotionQuery): Prisma.PromotionWhereInput => ({
  ...(query.kind ? { kind: query.kind } : {}),
  ...(query.state ? { state: query.state } : {}),
  ...(query.q ? { name: { contains: query.q } } : {}),
});

const toPolicyData = (body: CreatePromotionBody) => {
  if (body.kind === "COUPON") {
    return {
      couponPolicy: { create: { ...body.coupon!, targetProductIds: undefined } },
      automaticPolicy: undefined,
      targetProductIds: body.coupon!.targetProductIds,
    };
  }
  if (body.kind === "FLASH_SALE") {
    return {
      couponPolicy: undefined,
      automaticPolicy: undefined,
      flashSalePolicy: {
        create: {
          priority: body.flashSale!.priority,
          stackableWithCoupon: body.flashSale!.stackableWithCoupon,
          showRemainingQuota: body.flashSale!.showRemainingQuota,
        },
      },
      flashSaleQuotas: {
        create: body.flashSale!.items.map((item) => ({
          productId: item.productId,
          totalQuota: item.totalQuota,
          maxUnitsPerUser: item.maxUnitsPerUser,
        })),
      },
      targetProductIds: [],
    };
  }
  return {
    couponPolicy: undefined,
    automaticPolicy: { create: { ...body.automatic!, targetProductIds: undefined } },
    targetProductIds: body.automatic!.targetProductIds,
  };
};

const getRow = async (id: number) => {
  const row = await prisma.promotion.findUnique({ where: { id }, include: promotionInclude });
  if (!row) throw notFound("Promotion");
  return row;
};

export const createPromotion = async (actorId: number, body: CreatePromotionBody) => {
  const policies = toPolicyData(body);
  const created = await prisma.$transaction(async (tx) =>
    tx.promotion.create({
      data: {
        kind: body.kind,
        state: "DRAFT",
        name: body.name,
        description: body.description,
        discountKind: body.discountKind,
        discountValue: body.discountValue,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        createdById: actorId,
        updatedById: actorId,
        ...(policies.couponPolicy ? { couponPolicy: policies.couponPolicy } : {}),
        ...(policies.automaticPolicy ? { automaticPolicy: policies.automaticPolicy } : {}),
        ...(policies.flashSalePolicy ? { flashSalePolicy: policies.flashSalePolicy } : {}),
        ...(policies.flashSaleQuotas ? { flashSaleQuotas: policies.flashSaleQuotas } : {}),
        products: {
          create: policies.targetProductIds.map((productId) => ({ productId })),
        },
      },
      include: promotionInclude,
    }),
  );
  return toPromotionDetailDto(created);
};

export const listPromotions = async (query: AdminPromotionQuery) => {
  const where = promotionWhere(query);
  const [total, rows] = await Promise.all([
    prisma.promotion.count({ where }),
    prisma.promotion.findMany({
      where,
      include: promotionInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { items: rows.map((row) => toPromotionSummaryDto(row)), meta: pageMeta(query, total) };
};

export const getPromotion = async (id: number) => toPromotionDetailDto(await getRow(id));

export const updatePromotion = async (id: number, actorId: number, body: UpdatePromotionBody) => {
  const current = await getRow(id);
  if (current.activatedAt) {
    const attemptedLockedField = Object.keys(body).some(
      (key) => pricingFields.has(key) && key !== "endsAt",
    );
    const couponCore = body.coupon
      ? Object.keys(body.coupon).some((key) =>
          [
            "code",
            "scope",
            "targetProductIds",
            "minOrderValue",
            "maxDiscount",
            "maxUsesPerUser",
          ].includes(key),
        )
      : false;
    const automaticCore = body.automatic
      ? Object.keys(body.automatic).some((key) =>
          ["priority", "stackableWithCoupon", "targetProductIds"].includes(key),
        )
      : false;
    const flashSaleCore = body.flashSale
      ? Object.keys(body.flashSale).some((key) => ["priority", "stackableWithCoupon"].includes(key))
      : false;
    if (attemptedLockedField || couponCore || automaticCore || flashSaleCore) {
      throw new AppError("Promotion commercial fields are locked", 409, "PROMOTION_FIELD_LOCKED");
    }
    if (body.endsAt && body.endsAt <= current.endsAt) {
      throw new AppError("Active promotion can only be extended", 409, "PROMOTION_FIELD_LOCKED");
    }
    if (
      body.coupon?.maxUses !== undefined &&
      current.couponPolicy?.maxUses !== null &&
      body.coupon.maxUses !== null &&
      body.coupon.maxUses < current.couponPolicy.maxUses
    ) {
      throw new AppError(
        "Active promotion usage limit can only increase",
        409,
        "PROMOTION_FIELD_LOCKED",
      );
    }
    if (body.flashSale?.items) {
      const currentQuotas = new Map(
        (current.flashSalePolicy?.quotas ?? []).map((quota) => [quota.productId, quota]),
      );
      for (const item of body.flashSale.items) {
        const existing = currentQuotas.get(item.productId);
        if (
          !existing ||
          item.maxUnitsPerUser !== existing.maxUnitsPerUser ||
          item.totalQuota < existing.claimedUnits
        ) {
          throw new AppError(
            "Active Flash Sale quota fields are locked",
            409,
            "PROMOTION_FIELD_LOCKED",
          );
        }
      }
      if (body.flashSale.items.length !== currentQuotas.size) {
        throw new AppError("Active Flash Sale targets are locked", 409, "PROMOTION_FIELD_LOCKED");
      }
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (body.coupon) {
      await tx.couponPolicy.update({
        where: { promotionId: id },
        data: {
          ...(body.coupon.isPublic !== undefined ? { isPublic: body.coupon.isPublic } : {}),
          ...(body.coupon.maxUses !== undefined ? { maxUses: body.coupon.maxUses } : {}),
        },
      });
    }
    if (body.flashSale) {
      if (current.activatedAt) {
        if (body.flashSale.showRemainingQuota !== undefined) {
          await tx.flashSalePolicy.update({
            where: { promotionId: id },
            data: { showRemainingQuota: body.flashSale.showRemainingQuota },
          });
        }
        for (const item of body.flashSale.items ?? []) {
          await tx.flashSaleProductQuota.update({
            where: { promotionId_productId: { promotionId: id, productId: item.productId } },
            data: { totalQuota: item.totalQuota },
          });
        }
      } else {
        await tx.flashSalePolicy.update({
          where: { promotionId: id },
          data: {
            ...(body.flashSale.priority !== undefined ? { priority: body.flashSale.priority } : {}),
            ...(body.flashSale.stackableWithCoupon !== undefined
              ? { stackableWithCoupon: body.flashSale.stackableWithCoupon }
              : {}),
            ...(body.flashSale.showRemainingQuota !== undefined
              ? { showRemainingQuota: body.flashSale.showRemainingQuota }
              : {}),
          },
        });
        if (body.flashSale.items) {
          if (
            body.flashSale.items.some(
              (item) =>
                item.productId === undefined ||
                item.totalQuota === undefined ||
                item.maxUnitsPerUser === undefined,
            )
          ) {
            throw new AppError("Flash Sale quota items are incomplete", 400, "VALIDATION_ERROR");
          }
          await tx.flashSaleProductQuota.deleteMany({ where: { promotionId: id } });
          await tx.flashSaleProductQuota.createMany({
            data: body.flashSale.items.map((item) => ({
              promotionId: id,
              productId: item.productId!,
              totalQuota: item.totalQuota!,
              maxUnitsPerUser: item.maxUnitsPerUser!,
            })),
          });
        }
      }
    }
    const pricingChanged =
      Object.keys(body).some((key) => pricingFields.has(key)) ||
      (Boolean(body.flashSale) && !current.activatedAt);
    const updated = await tx.promotion.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.discountKind !== undefined ? { discountKind: body.discountKind } : {}),
        ...(body.discountValue !== undefined ? { discountValue: body.discountValue } : {}),
        ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
        ...(body.endsAt !== undefined ? { endsAt: body.endsAt } : {}),
        updatedById: actorId,
        ...(pricingChanged ? { pricingVersion: { increment: 1 } } : {}),
      },
      include: promotionInclude,
    });
    if (pricingChanged) {
      const productIds = [
        ...(current.products ?? []).map((target) => target.productId),
        ...(current.flashSalePolicy?.quotas ?? []).map((quota) => quota.productId),
      ];
      await requestPricingReevaluation(tx, {
        productIds,
        eventVersion: String(updated.pricingVersion),
        availableAt: body.startsAt && body.startsAt > new Date() ? body.startsAt : undefined,
      });
    }
    return updated;
  });
  return toPromotionDetailDto(updated);
};

export const transitionPromotion = async (
  id: number,
  actorId: number,
  action: "ACTIVATE" | "PAUSE" | "RESUME" | "END",
) => {
  const current = await getRow(id);
  const now = new Date();
  const state = current.state;
  if (action === "ACTIVATE" && state !== "DRAFT")
    throw new AppError("Promotion cannot be activated", 409, "PROMOTION_INVALID_TRANSITION");
  if (action === "PAUSE" && state !== "ACTIVE")
    throw new AppError("Promotion cannot be paused", 409, "PROMOTION_INVALID_TRANSITION");
  if (action === "RESUME" && (state !== "PAUSED" || now >= current.endsAt))
    throw new AppError("Promotion cannot be resumed", 409, "PROMOTION_INVALID_TRANSITION");
  if (action === "END" && !["ACTIVE", "PAUSED"].includes(state))
    throw new AppError("Promotion cannot be ended", 409, "PROMOTION_INVALID_TRANSITION");
  if (
    action === "ACTIVATE" &&
    current.kind === "FLASH_SALE" &&
    (!current.flashSalePolicy || current.flashSalePolicy.quotas.length === 0)
  )
    throw new AppError("Flash Sale needs quota items", 409, "PROMOTION_INVALID_TRANSITION");
  const nextState =
    action === "ACTIVATE" || action === "RESUME"
      ? "ACTIVE"
      : action === "PAUSE"
        ? "PAUSED"
        : "ENDED";
  const updated = await prisma.$transaction(async (tx) => {
    const promotion = await tx.promotion.update({
      where: { id },
      data: {
        state: nextState,
        updatedById: actorId,
        ...(action === "ACTIVATE" ? { activatedAt: now } : {}),
        pricingVersion: { increment: 1 },
      },
      include: promotionInclude,
    });
    const productIds = [
      ...(current.products ?? []).map((target) => target.productId),
      ...(current.flashSalePolicy?.quotas ?? []).map((quota) => quota.productId),
    ];
    await requestPricingReevaluation(tx, {
      productIds,
      eventVersion: String(promotion.pricingVersion),
      availableAt:
        ["ACTIVATE", "RESUME"].includes(action) && current.startsAt > now
          ? current.startsAt
          : undefined,
    });
    return promotion;
  });
  return toPromotionDetailDto(updated);
};

export const clonePromotion = async (id: number, actorId: number) => {
  const current = await getRow(id);
  const code = current.couponPolicy
    ? `CLONE-${id}-${Date.now().toString(36).toUpperCase()}`.slice(0, 50)
    : undefined;
  const created = await prisma.$transaction(async (tx) =>
    tx.promotion.create({
      data: {
        kind: current.kind,
        state: "DRAFT",
        name: `${current.name} (copy)`.slice(0, 150),
        description: current.description,
        discountKind: current.discountKind,
        discountValue: current.discountValue,
        startsAt: current.startsAt,
        endsAt: current.endsAt,
        createdById: actorId,
        updatedById: actorId,
        ...(current.couponPolicy
          ? {
              couponPolicy: {
                create: { ...current.couponPolicy, promotionId: undefined, code: code! },
              },
            }
          : current.flashSalePolicy
            ? {
                flashSalePolicy: {
                  create: {
                    priority: current.flashSalePolicy.priority,
                    stackableWithCoupon: current.flashSalePolicy.stackableWithCoupon,
                    showRemainingQuota: current.flashSalePolicy.showRemainingQuota,
                  },
                },
                flashSaleQuotas: {
                  create: current.flashSalePolicy.quotas.map((quota) => ({
                    productId: quota.productId,
                    totalQuota: quota.totalQuota,
                    maxUnitsPerUser: quota.maxUnitsPerUser,
                  })),
                },
              }
            : {
                automaticPolicy: {
                  create: {
                    priority: current.automaticPolicy!.priority,
                    stackableWithCoupon: current.automaticPolicy!.stackableWithCoupon,
                  },
                },
              }),
        ...(current.flashSalePolicy
          ? {}
          : {
              products: {
                create: current.products.map((target) => ({ productId: target.productId })),
              },
            }),
      },
      include: promotionInclude,
    }),
  );
  return toPromotionDetailDto(created);
};

export const listPromotionRedemptions = async (id: number, query: PromotionRedemptionQuery) => {
  await getRow(id);
  const where = { promotionId: id };
  const [total, rows] = await Promise.all([
    prisma.promotionRedemption.count({ where }),
    prisma.promotionRedemption.findMany({
      where,
      include: redemptionInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { items: rows.map(toRedemptionDto), meta: pageMeta(query, total) };
};

export const getPromotionSummary = async (id: number) => {
  const promotion = await getRow(id);
  if (promotion.kind === "FLASH_SALE") {
    const quotas = await prisma.flashSaleProductQuota.findMany({
      where: { promotionId: id },
      select: { productId: true, totalQuota: true, claimedUnits: true },
    });
    const [allocationAggregate, releasedAggregate, completedAggregate] = await Promise.all([
      prisma.flashSaleAllocation.aggregate({
        where: { promotionId: id },
        _sum: { quantity: true, discountAmount: true },
        _count: { _all: true },
      }),
      prisma.flashSaleAllocation.aggregate({
        where: { promotionId: id, status: "RELEASED" },
        _sum: { quantity: true },
      }),
      prisma.flashSaleAllocation.aggregate({
        where: { promotionId: id, status: "CLAIMED", order: { status: "COMPLETED" } },
        _sum: { quantity: true },
      }),
    ]);
    const totalQuota = quotas.reduce((sum, quota) => sum + quota.totalQuota, 0);
    const claimedUnits = quotas.reduce((sum, quota) => sum + quota.claimedUnits, 0);
    return {
      promotionId: id,
      kind: promotion.kind,
      totalQuota,
      claimedUnits,
      remainingUnits: Math.max(0, totalQuota - claimedUnits),
      releasedUnits: releasedAggregate._sum.quantity ?? 0,
      completedUnits: completedAggregate._sum.quantity ?? 0,
      allocationCount: allocationAggregate._count._all,
      totalDiscountAmount: allocationAggregate._sum.discountAmount ?? 0,
      breakdown: quotas.map((quota) => ({
        productId: quota.productId,
        totalQuota: quota.totalQuota,
        claimedUnits: quota.claimedUnits,
        remainingUnits: Math.max(0, quota.totalQuota - quota.claimedUnits),
      })),
    };
  }
  const aggregate = await prisma.promotionRedemption.aggregate({
    where: { promotionId: id },
    _sum: { discountAmount: true },
    _count: { _all: true },
  });
  return {
    promotionId: id,
    kind: promotion.kind,
    redemptionCount: aggregate._count._all,
    activeUsageCount: promotion.couponPolicy?.usedCount ?? 0,
    totalDiscountAmount: aggregate._sum.discountAmount ?? 0,
  };
};

export const listFlashSaleAllocations = async (id: number, query: FlashSaleAllocationQuery) => {
  const promotion = await getRow(id);
  if (promotion.kind !== "FLASH_SALE") {
    throw new AppError("Promotion is not a Flash Sale", 409, "PROMOTION_KIND_MISMATCH");
  }
  const where = {
    promotionId: id,
    ...(query.status ? { status: query.status } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.flashSaleAllocation.count({ where }),
    prisma.flashSaleAllocation.findMany({
      where,
      include: flashSaleAllocationInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { items: rows.map(toFlashSaleAllocationDto), meta: pageMeta(query, total) };
};

const couponFromRow = (row: any): ResolvedCoupon => ({
  id: row.id,
  code: row.couponPolicy.code,
  name: row.name,
  promotionName: row.name,
  scope: row.couponPolicy.scope,
  discountKind: row.discountKind,
  discountValue: row.discountValue,
  minOrderValue: row.couponPolicy.minOrderValue,
  maxDiscount: row.couponPolicy.maxDiscount,
  pricingVersion: row.pricingVersion,
  targetProductIds: row.products.map((target: { productId: number }) => target.productId),
});

export const resolveCoupon = async (
  client: PrismaClientLike,
  code: string,
  _userId: number,
  _lines: PricingLineInput[],
  now: Date,
): Promise<ResolvedCoupon> => {
  const row = await (client as any).promotion.findFirst({
    where: { kind: "COUPON", couponPolicy: { code: code.trim().toUpperCase() } },
    include: promotionInclude,
  });
  if (!row) throw new AppError("Promotion not found", 404, "PROMOTION_NOT_FOUND");
  if (row.state !== "ACTIVE" || now < row.startsAt || now >= row.endsAt || !row.couponPolicy) {
    throw new AppError("Promotion is not active", 409, "PROMOTION_NOT_ACTIVE");
  }
  return couponFromRow(row);
};

const quoteLineInput = (
  line: any,
  promotions: Awaited<ReturnType<typeof resolveProductPromotions>>,
): PricingLineInput => ({
  productId: line.productId,
  quantity: line.quantity,
  listPrice: line.product.price,
  promotion: promotions.get(line.productId)?.winner ?? null,
  promotionFallback: promotions.get(line.productId)?.fallback ?? null,
});

export const quoteOrder = async (
  userId: number,
  couponCode?: string,
  now = new Date(),
): Promise<PricingQuoteDto> => {
  const lines = await prisma.cartDetail.findMany({
    where: { cart: { userId } },
    include: { product: { select: { id: true, price: true, isActive: true } } },
    orderBy: { productId: "asc" },
  });
  if (lines.length === 0) throw new AppError("Cart is empty", 409, "CART_EMPTY");
  const promotions = await resolveProductPromotions(
    prisma,
    lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    { now, userId, eligibilityMode: "EXACT" },
  );
  const inputs = lines.map((line) => quoteLineInput(line, promotions));
  const coupon = couponCode ? await resolveCoupon(prisma, couponCode, userId, inputs, now) : null;
  const pricing = calculatePromotionPricing({ lines: inputs, coupon });
  const minimumBase =
    coupon?.scope === "PRODUCT"
      ? pricing.couponEligibleSubtotal
      : pricing.subtotalPrice - pricing.productDiscountAmount;
  if (coupon && minimumBase < coupon.minOrderValue) {
    throw new AppError("Minimum order value is not met", 409, "MIN_ORDER_NOT_MET");
  }
  const fingerprint = createPricingFingerprint({
    lines: inputs.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      listPrice: line.listPrice,
      promotion: line.promotion,
    })),
    coupon: coupon
      ? {
          id: coupon.id,
          pricingVersion: coupon.pricingVersion,
          scope: coupon.scope,
          targetProductIds: coupon.targetProductIds,
        }
      : null,
    totals: pricing,
  });
  return {
    subtotal: pricing.subtotalPrice,
    productDiscount: pricing.productDiscountAmount,
    couponEligibleSubtotal: pricing.couponEligibleSubtotal,
    couponDiscount: pricing.couponDiscountAmount,
    total: pricing.totalPrice,
    lines: pricing.lines,
    coupon: coupon ? { id: coupon.id, code: coupon.code, name: coupon.name, valid: true } : null,
    calculatedAt: now,
    pricingFingerprint: fingerprint,
  };
};

export const listAvailablePromotions = async (now = new Date()) => {
  const rows = await prisma.promotion.findMany({
    where: { kind: "COUPON", state: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
    include: { couponPolicy: true, products: { select: { productId: true } } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  return rows
    .filter((row: any) => row.couponPolicy?.isPublic)
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      code: row.couponPolicy.code,
      scope: row.couponPolicy.scope,
      discountKind: row.discountKind,
      discountValue: row.discountValue,
      minOrderValue: row.couponPolicy.minOrderValue,
      maxDiscount: row.couponPolicy.maxDiscount,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    }));
};
