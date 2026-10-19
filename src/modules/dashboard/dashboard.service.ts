import { prisma } from "config/client";
import { LOW_STOCK_THRESHOLD } from "modules/products/products.schema";
import { ORDER_STATUS, ORDER_STATUSES, OrderStatus } from "modules/orders/order-status";

export const getDashboard = async () => {
  const [userCount, productCount, orderCount, revenue, grouped, lowStockCount] = await Promise.all([
    prisma.user.count(),
    prisma.product.count(),
    prisma.order.count(),
    prisma.order.aggregate({
      where: { status: ORDER_STATUS.COMPLETED },
      _sum: { totalPrice: true },
    }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.product.count({ where: { isActive: true, quantity: { lte: LOW_STOCK_THRESHOLD } } }),
  ]);
  const ordersByStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
    OrderStatus,
    number
  >;
  for (const g of grouped) ordersByStatus[g.status as OrderStatus] = g._count._all;
  return {
    userCount,
    productCount,
    orderCount,
    revenue: revenue._sum.totalPrice ?? 0,
    ordersByStatus,
    lowStockCount,
  };
};
