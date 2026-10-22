import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import {
  AdminPromotionQuery,
  CreatePromotionBody,
  PromotionRedemptionQuery,
  UpdatePromotionBody,
} from "modules/promotions/promotions.schema";
import { promotionInclude, redemptionInclude } from "modules/promotions/promotions.repository";
import {
  toPromotionDetailDto,
  toPromotionSummaryDto,
  toRedemptionDto,
} from "modules/promotions/promotions.mapper";
import { calculatePromotionPricing } from "modules/promotions/promotion-pricing";
import { createPricingFingerprint } from "modules/promotions/promotion-fingerprint";
import {
  resolveAutomaticPromotions,
  type PrismaClientLike,
} from "modules/promotions/promotion-resolver";
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
    const attemptedLockedField = Object.keys(body).some((key) => pricingFields.has(key));
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
    if (attemptedLockedField || couponCore || automaticCore) {
      throw new AppError("Promotion commercial fields are locked", 409, "PROMOTION_FIELD_LOCKED");
    }
    if (body.endsAt && body.endsAt <= current.endsAt) {
      throw new AppError("Active promotion can only be extended", 409, "PROMOTION_FIELD_LOCKED");
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
    const pricingChanged = Object.keys(body).some((key) => pricingFields.has(key));
    return tx.promotion.update({
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
  const nextState =
    action === "ACTIVATE" || action === "RESUME"
      ? "ACTIVE"
      : action === "PAUSE"
        ? "PAUSED"
        : "ENDED";
  const updated = await prisma.promotion.update({
    where: { id },
    data: {
      state: nextState,
      updatedById: actorId,
      ...(action === "ACTIVATE" ? { activatedAt: now } : {}),
      pricingVersion: { increment: 1 },
    },
    include: promotionInclude,
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
          : {
              automaticPolicy: {
                create: {
                  priority: current.automaticPolicy!.priority,
                  stackableWithCoupon: current.automaticPolicy!.stackableWithCoupon,
                },
              },
            }),
        products: { create: current.products.map((target) => ({ productId: target.productId })) },
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
  promotions: Awaited<ReturnType<typeof resolveAutomaticPromotions>>,
): PricingLineInput => ({
  productId: line.productId,
  quantity: line.quantity,
  listPrice: line.product.price,
  automaticCandidates: promotions.has(line.productId) ? [promotions.get(line.productId)!] : [],
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
  const promotions = await resolveAutomaticPromotions(
    prisma,
    lines.map((line) => line.productId),
    now,
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
      automaticPromotionId: line.automaticCandidates?.[0]?.id ?? null,
      pricingVersion: line.automaticCandidates?.[0]?.pricingVersion ?? null,
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
