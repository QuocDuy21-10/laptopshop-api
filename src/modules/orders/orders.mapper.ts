import { Prisma } from "@prisma/client";
import { productImage } from "modules/products/products.mapper";

export const orderInclude = {
  orderDetails: {
    include: { product: { select: { name: true, image: true } } },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.OrderInclude;
export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export const toOrderDto = (o: OrderRow) => ({
  id: o.id,
  status: o.status,
  totalPrice: o.totalPrice,
  subtotalPrice: o.subtotalPrice,
  productDiscountAmount: o.productDiscountAmount,
  couponEligibleSubtotal: o.couponEligibleSubtotal,
  couponDiscountAmount: o.couponDiscountAmount,
  couponCode: o.couponCode,
  couponName: o.couponName,
  paymentRequired: o.paymentMethod !== "FREE" && o.totalPrice > 0,
  paymentMethod: o.paymentMethod,
  paymentStatus: o.paymentStatus,
  receiverName: o.receiverName,
  receiverAddress: o.receiverAddress,
  receiverPhone: o.receiverPhone,
  createdAt: o.createdAt,
  items: o.orderDetails.map((d) => ({
    productId: d.productId,
    name: d.product.name,
    image: productImage(d.product.image),
    price: d.price,
    quantity: d.quantity,
    productDiscountAmount: d.productDiscountAmount,
    couponDiscountAmount: d.couponDiscountAmount,
    netLineTotal: d.price * d.quantity - d.productDiscountAmount - d.couponDiscountAmount,
    automaticPromotionId: d.automaticPromotionId,
    automaticPromotionName: d.automaticPromotionName,
  })),
});
export type OrderDto = ReturnType<typeof toOrderDto>;

export const adminOrderInclude = {
  ...orderInclude,
  user: { select: { id: true, username: true, fullName: true } },
} satisfies Prisma.OrderInclude;
export type AdminOrderRow = Prisma.OrderGetPayload<{ include: typeof adminOrderInclude }>;

export const toAdminOrderDto = (o: AdminOrderRow) => ({
  ...toOrderDto(o),
  completedAt: o.completedAt,
  user: o.user,
});

const actorSelect = { select: { id: true, fullName: true, username: true } } as const;

export const adminOrderDetailInclude = {
  ...adminOrderInclude,
  history: { orderBy: { createdAt: "asc" }, include: { actor: actorSelect } },
} satisfies Prisma.OrderInclude;
export type AdminOrderDetailRow = Prisma.OrderGetPayload<{
  include: typeof adminOrderDetailInclude;
}>;

export const toActor = (a: { id: number; fullName: string | null; username: string } | null) =>
  a ? { id: a.id, name: a.fullName ?? a.username } : null;

export const toAdminOrderDetailDto = (o: AdminOrderDetailRow) => ({
  ...toAdminOrderDto(o),
  history: o.history.map((h) => ({
    fromStatus: h.fromStatus,
    toStatus: h.toStatus,
    actor: toActor(h.actor),
    createdAt: h.createdAt,
  })),
});
