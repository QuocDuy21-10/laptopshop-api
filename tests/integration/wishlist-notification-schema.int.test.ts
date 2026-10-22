import { prisma } from "config/client";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("wishlist and notification schema contract", () => {
  it("enforces one wishlist item per user and product", async () => {
    const user = await createUser();
    const product = await createProduct(0);

    await prisma.wishlistItem.create({ data: { userId: user.id, productId: product.id } });

    await expect(
      prisma.wishlistItem.create({ data: { userId: user.id, productId: product.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("cascades wishlist rows and keeps notification snapshots when a product is deleted", async () => {
    const user = await createUser();
    const product = await createProduct(0);
    const wishlist = await prisma.wishlistItem.create({
      data: { userId: user.id, productId: product.id },
    });
    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        productId: product.id,
        type: "PRICE_DROP",
        title: "Giảm giá",
        message: "Sản phẩm vừa giảm giá",
        oldPrice: 1_000,
        newPrice: 900,
        dedupeKey: `price-drop:${user.id}:${product.id}`,
      },
    });

    await prisma.product.delete({ where: { id: product.id } });

    await expect(
      prisma.wishlistItem.findUnique({ where: { id: wishlist.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.notification.findUnique({ where: { id: notification.id } }),
    ).resolves.toMatchObject({
      productId: null,
      title: "Giảm giá",
    });
  });

  it("cascades wishlist and notifications when a user is deleted", async () => {
    const user = await createUser();
    const product = await createProduct(0);
    await prisma.wishlistItem.create({ data: { userId: user.id, productId: product.id } });
    await prisma.notification.create({
      data: {
        userId: user.id,
        productId: product.id,
        type: "PRICE_DROP",
        title: "Giảm giá",
        message: "Sản phẩm vừa giảm giá",
        dedupeKey: `price-drop:user:${user.id}`,
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    await expect(prisma.wishlistItem.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.notification.count({ where: { userId: user.id } })).resolves.toBe(0);
  });
});
