import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import {
  assertDayRange,
  DAY_MS,
  dayEnd,
  dayStart,
  SHOP_UTC_OFFSET,
  toShopDay,
} from "lib/shop-time";
import { SalesQuery } from "modules/dashboard/dashboard.schema";
import { LOW_STOCK_THRESHOLD } from "modules/products/products.schema";
import { ORDER_STATUS, ORDER_STATUSES, OrderStatus } from "modules/orders/order-status";

export const getDashboard = async () => {
  const [userCount, productCount, orderCount, revenue, grouped, lowStockCount, outOfStockCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.product.count(),
      prisma.order.count(),
      prisma.order.aggregate({
        where: { status: ORDER_STATUS.COMPLETED },
        _sum: { totalPrice: true },
      }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.product.count({
        where: { isActive: true, quantity: { gte: 1, lte: LOW_STOCK_THRESHOLD } },
      }),
      prisma.product.count({ where: { isActive: true, quantity: 0 } }),
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
    outOfStockCount,
  };
};

const MAX_SALES_DAYS = 366;

type DayRow = { day: string; revenue: unknown; orders: unknown };
type TopRow = { productId: number; name: string; quantity: unknown; revenue: unknown };

export const getSales = async ({ from, to }: SalesQuery) => {
  assertDayRange(from, to, MAX_SALES_DAYS);
  const start = dayStart(from);
  const end = dayEnd(to);
  // orders completed before completedAt existed fall back to their order day
  const doneAt = Prisma.sql`COALESCE(o.completedAt, o.createdAt)`;
  const completedIn = Prisma.sql`o.status = 'COMPLETED' AND ${doneAt} >= ${start} AND ${doneAt} < ${end}`;
  const [days, top] = await Promise.all([
    prisma.$queryRaw<DayRow[]>`
      SELECT DATE_FORMAT(CONVERT_TZ(${doneAt}, '+00:00', ${SHOP_UTC_OFFSET}), '%Y-%m-%d') AS day,
             SUM(o.totalPrice) AS revenue, COUNT(*) AS orders
      FROM orders o
      WHERE ${completedIn}
      GROUP BY day`,
    prisma.$queryRaw<TopRow[]>`
      SELECT od.productId AS productId, p.name AS name,
             SUM(od.quantity) AS quantity,
             SUM(od.price * od.quantity - od.productDiscountAmount - od.couponDiscountAmount) AS revenue
      FROM order_detail od
      JOIN orders o ON o.id = od.orderId
      JOIN products p ON p.id = od.productId
      WHERE ${completedIn}
      GROUP BY od.productId, p.name
      ORDER BY revenue DESC
      LIMIT 5`,
  ]);
  // SUM/COUNT come back as Decimal or BigInt
  const byDay = new Map(days.map((d) => [d.day, d]));
  const daily = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
    const date = toShopDay(new Date(t));
    const row = byDay.get(date);
    daily.push({ date, revenue: Number(row?.revenue ?? 0), orders: Number(row?.orders ?? 0) });
  }
  return {
    daily,
    topProducts: top.map((r) => ({
      productId: Number(r.productId),
      name: r.name,
      quantity: Number(r.quantity),
      revenue: Number(r.revenue),
    })),
    totals: {
      revenue: daily.reduce((s, d) => s + d.revenue, 0),
      orders: daily.reduce((s, d) => s + d.orders, 0),
    },
  };
};
