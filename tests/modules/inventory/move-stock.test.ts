import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { AppError } from "lib/errors";
import { moveStock } from "modules/inventory/inventory.service";

beforeEach(resetPrisma);

describe("moveStock", () => {
  it("writes balanceBefore and balanceAfter from the locked product row", async () => {
    prismaMock.product.update.mockResolvedValue({ quantity: 8 });
    prismaMock.product.findUniqueOrThrow.mockResolvedValue({ quantity: 8 });
    await moveStock(prismaMock, { productId: 1, delta: 5, reason: "RESTOCK", actorId: 7 });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: {
        productId: 1,
        delta: 5,
        reason: "RESTOCK",
        orderId: undefined,
        actorId: 7,
        note: undefined,
        balanceBefore: 3,
        balanceAfter: 8,
      },
    });
  });

  it("decrements conditionally, counts the sale and writes the movement", async () => {
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.findUniqueOrThrow.mockResolvedValue({ quantity: 3 });
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
      data: {
        productId: 1,
        delta: -2,
        reason: "ORDER",
        orderId: 50,
        actorId: 7,
        note: undefined,
        balanceBefore: 5,
        balanceAfter: 3,
      },
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
    prismaMock.product.update.mockResolvedValue({ quantity: 2 });
    await moveStock(prismaMock, { productId: 1, delta: 2, reason: "ORDER_CANCEL", orderId: 50 });
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { quantity: { increment: 2 }, sold: { decrement: 2 } },
    });
  });

  it("does not touch sold for manual movements", async () => {
    prismaMock.product.update.mockResolvedValue({ quantity: 5 });
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

  it("restocks an active-only move conditionally", async () => {
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.findUniqueOrThrow.mockResolvedValue({ quantity: 7 });
    await moveStock(prismaMock, {
      productId: 1,
      delta: 2,
      reason: "RESTOCK",
      receiptId: "r1",
      onlyActive: true,
    });
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
      where: { id: 1, isActive: true },
      data: { quantity: { increment: 2 } },
    });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(prismaMock.stockMovement.create.mock.calls[0][0].data).toMatchObject({
      balanceBefore: 5,
      balanceAfter: 7,
      receiptId: "r1",
    });
  });

  it("refuses to restock a hidden product when only active products may move", async () => {
    prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.product.findUnique.mockResolvedValue({ id: 1 });
    await expect(
      moveStock(prismaMock, { productId: 1, delta: 2, reason: "RESTOCK", onlyActive: true }),
    ).rejects.toMatchObject({ status: 409, code: "PRODUCT_UNAVAILABLE" });
    expect(prismaMock.stockMovement.create).not.toHaveBeenCalled();
  });

  it("turns an active-only restock of a missing product into 404", async () => {
    prismaMock.product.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.product.findUnique.mockResolvedValue(null);
    await expect(
      moveStock(prismaMock, { productId: 9, delta: 2, reason: "RESTOCK", onlyActive: true }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
