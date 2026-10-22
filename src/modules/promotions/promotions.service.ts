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
