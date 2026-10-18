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
  })),
});
export type OrderDto = ReturnType<typeof toOrderDto>;

export const adminOrderInclude = {
  ...orderInclude,
  user: { select: { id: true, username: true, fullName: true } },
} satisfies Prisma.OrderInclude;
export type AdminOrderRow = Prisma.OrderGetPayload<{ include: typeof adminOrderInclude }>;

export const toAdminOrderDto = (o: AdminOrderRow) => ({ ...toOrderDto(o), user: o.user });
