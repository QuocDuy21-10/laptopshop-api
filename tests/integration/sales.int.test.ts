import { prisma } from "config/client";
import { getSales } from "modules/dashboard/dashboard.service";
import { placeOrder } from "modules/orders/orders.service";
import { createProduct, createUser, putInCart, quotedReceiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("sales report", () => {
  it("puts an order completed at 17:30 UTC on the next Vietnam day", async () => {
    const product = await createProduct(5, 700);
    const user = await createUser();
    await putInCart(user.id, product.id, 2);
    const { order } = await placeOrder(user.id, "s", await quotedReceiver(user.id));
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "COMPLETED", completedAt: new Date("2026-10-01T17:30:00Z") },
    });

    const report = await getSales({ from: "2026-10-01", to: "2026-10-02" });

    expect(report.daily).toEqual([
      { date: "2026-10-01", revenue: 0, orders: 0 },
      { date: "2026-10-02", revenue: 1400, orders: 1 },
    ]);
    expect(report.topProducts).toEqual([
      { productId: product.id, name: product.name, quantity: 2, revenue: 1400 },
    ]);
  });
});
