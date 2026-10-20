import { prisma } from "config/client";
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
});
