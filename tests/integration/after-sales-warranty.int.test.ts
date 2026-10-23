import { prisma } from "config/client";
import { changeStatus, placeOrder } from "modules/orders/orders.service";
import { createProduct, createUser, putInCart, receiver, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("warranty snapshots", () => {
  it("keeps the checkout warranty when the product policy changes before completion", async () => {
    const user = await createUser();
    const product = await createProduct(2, 1000, 24);
    await putInCart(user.id, product.id, 1);

    const placed = await placeOrder(user.id, "warranty-snapshot", receiver);
    const createdDetail = await prisma.orderDetail.findFirstOrThrow({
      where: { orderId: placed.order.id },
    });
    expect(createdDetail.warrantyMonthsSnapshot).toBe(24);
    expect(createdDetail.warrantyStartAt).toBeNull();
    expect(createdDetail.warrantyEndAt).toBeNull();

    await prisma.product.update({ where: { id: product.id }, data: { warrantyMonths: 6 } });
    await changeStatus(placed.order.id, "SHIPPING", { actorId: user.id });
    await changeStatus(placed.order.id, "COMPLETED", { actorId: user.id });
    const completedOrder = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });

    const completedDetail = await prisma.orderDetail.findUniqueOrThrow({
      where: { id: createdDetail.id },
    });
    expect(completedDetail.warrantyMonthsSnapshot).toBe(24);
    expect(completedDetail.warrantyStartAt).toEqual(completedOrder.completedAt);
    expect(completedDetail.warrantyEndAt?.getTime()).toBe(
      new Date(completedOrder.completedAt!.getTime()).setUTCFullYear(
        completedOrder.completedAt!.getUTCFullYear() + 2,
      ),
    );
  });
});
