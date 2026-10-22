import { Prisma } from "@prisma/client";

const actorSelect = { select: { id: true, fullName: true, username: true } } as const;

export const promotionInclude = {
  createdBy: actorSelect,
  updatedBy: actorSelect,
  couponPolicy: true,
  automaticPolicy: true,
  products: { include: { product: { select: { id: true, name: true, image: true } } } },
  _count: { select: { redemptions: true } },
} satisfies Prisma.PromotionInclude;
export type PromotionRow = Prisma.PromotionGetPayload<{ include: typeof promotionInclude }>;

export const redemptionInclude = {
  user: { select: { id: true, username: true, fullName: true } },
  order: { select: { id: true, status: true, totalPrice: true } },
} satisfies Prisma.PromotionRedemptionInclude;
export type RedemptionRow = Prisma.PromotionRedemptionGetPayload<{
  include: typeof redemptionInclude;
}>;
