import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { AppError } from "lib/errors";
import { moveStock } from "modules/inventory/inventory.service";

beforeEach(resetPrisma);

describe("moveStock", () => {
  it("decrements conditionally, counts the sale and writes the movement", async () => {
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    await moveStock(prismaMock, {
      productId: 1,
      delta: -2,
      reason: "ORDER",
      orderId: 50,
      actorId: 7,
      onlyActive: true,
    });
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
      where: { id: 1, quantity: { gte: 2 }, isActive: true },
      data: { quantity: { decrement: 2 }, sold: { increment: 2 } },
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: { productId: 1, delta: -2, reason: "ORDER", orderId: 50, actorId: 7, note: undefined },
    });
  });

  it("refuses to go negative and writes nothing", async () => {
    prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      moveStock(prismaMock, { productId: 1, delta: -3, reason: "CORRECTION", note: "x" }),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });

  it("restocks a cancelled order and gives the sale back", async () => {
    await moveStock(prismaMock, { productId: 1, delta: 2, reason: "ORDER_CANCEL", orderId: 50 });
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { quantity: { increment: 2 }, sold: { decrement: 2 } },
    });
  });

  it("does not touch sold for manual movements", async () => {
    await moveStock(prismaMock, { productId: 1, delta: 5, reason: "RESTOCK" });
    expect(prismaMock.product.update.mock.calls[0][0].data).toEqual({
      quantity: { increment: 5 },
    });
  });

  it("turns a missing product into 404", async () => {
    prismaMock.product.update.mockRejectedValue(prismaError("P2025"));
    await expect(
      moveStock(prismaMock, { productId: 9, delta: 1, reason: "RESTOCK" }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
