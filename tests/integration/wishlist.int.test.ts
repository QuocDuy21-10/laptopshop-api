import { prisma } from "config/client";
import { putWishlistItem } from "modules/wishlist/wishlist.service";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("wishlist concurrency", () => {
  it("does not exceed 100 items when two inserts race at the limit", async () => {
    const user = await createUser();
    const products = [];
    for (let index = 0; index < 101; index += 1)
      products.push(await createProduct(0, 1_000 + index));
    await prisma.wishlistItem.createMany({
      data: products.slice(0, 99).map((product) => ({ userId: user.id, productId: product.id })),
    });

    const results = await Promise.allSettled([
      putWishlistItem(user.id, products[99].id),
      putWishlistItem(user.id, products[100].id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: { code: "WISHLIST_LIMIT_REACHED" },
    });
    await expect(prisma.wishlistItem.count({ where: { userId: user.id } })).resolves.toBe(100);
  });

  it("keeps a concurrent duplicate PUT idempotent", async () => {
    const user = await createUser();
    const product = await createProduct(0, 2_000);

    const results = await Promise.all([
      putWishlistItem(user.id, product.id),
      putWishlistItem(user.id, product.id),
    ]);

    expect(results.map((result) => result.productId)).toEqual([product.id, product.id]);
    await expect(
      prisma.wishlistItem.count({ where: { userId: user.id, productId: product.id } }),
    ).resolves.toBe(1);
  });
});
