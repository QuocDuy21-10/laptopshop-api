import { prisma } from "config/client";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("review image sync schema on MySQL", () => {
  it("persists case-distinct sync keys for one user and review", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    const orderDetail = await createCompletedOrderItem(user.id, product.id);
    const review = await prisma.review.create({
      data: {
        userId: user.id,
        productId: product.id,
        orderDetailId: orderDetail.id,
        rating: 5,
        content: "Nội dung review đủ dài.",
        isAnonymous: true,
      },
    });
    const base = {
      userId: user.id,
      reviewId: review.id,
      requestFingerprint: "a".repeat(64),
      expectedVersion: 0,
      manifest: { expectedVersion: 0, items: [] },
      status: "PROCESSING" as const,
    };

    await prisma.reviewImageSyncOperation.create({
      data: { ...base, idempotencyKey: "Case-Key" },
    });
    await expect(
      prisma.reviewImageSyncOperation.create({
        data: { ...base, idempotencyKey: "case-key", requestFingerprint: "b".repeat(64) },
      }),
    ).resolves.toMatchObject({ idempotencyKey: "case-key" });
  });

  it("sets review image operation linkage null when operation is deleted", async () => {
    const user = await createUser();
    const product = await createProduct(1);
    const orderDetail = await createCompletedOrderItem(user.id, product.id);
    const review = await prisma.review.create({
      data: {
        userId: user.id,
        productId: product.id,
        orderDetailId: orderDetail.id,
        rating: 5,
        content: "Nội dung review đủ dài.",
        isAnonymous: true,
      },
    });
    const operation = await prisma.reviewImageSyncOperation.create({
      data: {
        userId: user.id,
        reviewId: review.id,
        idempotencyKey: "operation-key",
        requestFingerprint: "a".repeat(64),
        expectedVersion: 0,
        manifest: { expectedVersion: 0, items: [] },
      },
    });
    const image = await prisma.reviewImage.create({
      data: {
        reviewId: review.id,
        syncOperationId: operation.id,
        syncClientId: "new-image",
        objectKey: `reviews/${review.id}/sync/${operation.id}/1.webp`,
        mimeType: "image/webp",
        byteSize: 10,
        width: 10,
        height: 10,
        position: 0,
        status: "PENDING",
      },
    });

    await prisma.reviewImageSyncOperation.delete({ where: { id: operation.id } });

    await expect(prisma.reviewImage.findUnique({ where: { id: image.id } })).resolves.toMatchObject(
      {
        syncOperationId: null,
      },
    );
  });
});
