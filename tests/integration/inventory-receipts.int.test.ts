import { prisma } from "config/client";
import { postReceipt, updateReceipt } from "modules/inventory/inventory-receipts.service";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("inventory receipt constraints", () => {
  it("enforces one product per receipt and restricts referenced product deletion", async () => {
    const admin = await createUser();
    const product = await createProduct(0);
    const receipt = await prisma.stockReceipt.create({
      data: {
        code: "PN-20261020-TEST0001",
        status: "DRAFT",
        createdById: admin.id,
        items: { create: { productId: product.id, quantity: 2 } },
      },
    });

    await expect(
      prisma.stockReceiptItem.create({
        data: { receiptId: receipt.id, productId: product.id, quantity: 1 },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(prisma.product.delete({ where: { id: product.id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("posts one receipt exactly once under concurrent requests", async () => {
    const admin = await createUser();
    const product = await createProduct(0);
    const receipt = await prisma.stockReceipt.create({
      data: {
        code: "PN-20261020-CONCURRENT1",
        createdById: admin.id,
        items: { create: { productId: product.id, quantity: 2 } },
      },
    });

    const results = await Promise.all([
      postReceipt(receipt.id, admin.id),
      postReceipt(receipt.id, admin.id),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      2,
    );
    expect(await prisma.stockMovement.count({ where: { receiptId: receipt.id } })).toBe(1);
  });

  it("rolls back status, products and movements when an item becomes inactive", async () => {
    const admin = await createUser();
    const product = await createProduct(0);
    const receipt = await prisma.stockReceipt.create({
      data: {
        code: "PN-20261020-ROLLBACK1",
        createdById: admin.id,
        items: { create: { productId: product.id, quantity: 2 } },
      },
    });
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });

    await expect(postReceipt(receipt.id, admin.id)).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    });
    expect(
      (await prisma.stockReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).status,
    ).toBe("DRAFT");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      0,
    );
    expect(await prisma.stockMovement.count({ where: { receiptId: receipt.id } })).toBe(0);
  });

  it("serializes patch against post without mixing item sets", async () => {
    const admin = await createUser();
    const product = await createProduct(0);
    const receipt = await prisma.stockReceipt.create({
      data: {
        code: "PN-20261020-RACE0001",
        createdById: admin.id,
        items: { create: { productId: product.id, quantity: 1 } },
      },
    });

    const results = await Promise.allSettled([
      postReceipt(receipt.id, admin.id),
      updateReceipt(receipt.id, { items: [{ productId: product.id, quantity: 3 }] }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const finalReceipt = await prisma.stockReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
      include: { items: true },
    });
    expect(finalReceipt.status).toBe("POSTED");
    const itemQuantity = finalReceipt.items[0].quantity;
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { receiptId: receipt.id },
    });
    expect(movement.delta).toBe(itemQuantity);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      itemQuantity,
    );
  });
});
