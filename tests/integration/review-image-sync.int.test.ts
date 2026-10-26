import sharp from "sharp";
import { prisma } from "config/client";
import { createReview } from "modules/reviews/reviews.service";
import {
  syncReviewImages,
  type ReviewImageSyncDeps,
} from "modules/reviews/review-image-sync.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const inputFile = async (name: string): Promise<Express.Multer.File> => {
  const buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#166534" },
  })
    .png()
    .toBuffer();
  return {
    fieldname: "files",
    originalname: `${name}.png`,
    encoding: "7bit",
    mimetype: "image/png",
    destination: "",
    filename: `${name}.png`,
    path: "",
    size: buffer.length,
    buffer,
    stream: undefined as never,
  };
};

const storage = (overrides: Partial<NonNullable<ReviewImageSyncDeps["storage"]>> = {}) => {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    storage: {
      putObject: async ({ key, body }: { key: string; body: Buffer }) => {
        objects.set(String(key), Buffer.from(body));
      },
      deleteObject: async (key: string) => {
        objects.delete(key);
      },
      objectExists: async (key: string) => objects.has(key),
      getSignedReadUrl: async (key: string) => `https://storage.test/${encodeURIComponent(key)}`,
      ...overrides,
    } as ReviewImageSyncDeps["storage"],
  };
};

const createReviewFixture = async () => {
  const user = await createUser();
  const product = await createProduct(3);
  const detail = await createCompletedOrderItem(user.id, product.id);
  const review = await createReview(user.id, product.id, {
    rating: 5,
    content: "Nội dung review đủ dài cho integration.",
    isAnonymous: true,
  });
  return { user, product, detail, review };
};

describe("review image sync on MySQL", () => {
  it("commits one image set and replays the same IDs/order", async () => {
    const { user, review } = await createReviewFixture();
    const fake = storage();
    const deps: ReviewImageSyncDeps = { storage: fake.storage, urlTtlSeconds: 60 };
    const manifest = {
      expectedVersion: 0,
      items: [{ kind: "new" as const, clientId: "one", fileIndex: 0 }],
    };

    const first = await syncReviewImages(deps, user.id, review.id, "sync-1", manifest, [
      await inputFile("one"),
    ]);
    const replay = await syncReviewImages(deps, user.id, review.id, "sync-1", manifest, [
      await inputFile("one"),
    ]);

    expect(first).toMatchObject({ reviewId: review.id, imageVersion: 1, replayed: false });
    expect(replay).toMatchObject({ reviewId: review.id, imageVersion: 1, replayed: true });
    expect(replay.images.map((image) => image.id)).toEqual(first.images.map((image) => image.id));
    expect(
      await prisma.reviewImage.count({
        where: { reviewId: review.id, status: "READY", deletedAt: null },
      }),
    ).toBe(1);
  });

  it("allows only one different-key operation at an expected version", async () => {
    const { user, review } = await createReviewFixture();
    const fake = storage();
    const deps: ReviewImageSyncDeps = { storage: fake.storage, urlTtlSeconds: 60 };
    const [first, second] = await Promise.allSettled([
      syncReviewImages(
        deps,
        user.id,
        review.id,
        "sync-a",
        {
          expectedVersion: 0,
          items: [{ kind: "new", clientId: "a", fileIndex: 0 }],
        },
        [await inputFile("a")],
      ),
      syncReviewImages(
        deps,
        user.id,
        review.id,
        "sync-b",
        {
          expectedVersion: 0,
          items: [{ kind: "new", clientId: "b", fileIndex: 0 }],
        },
        [await inputFile("b")],
      ),
    ]);

    expect([first, second].filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      [first, second]
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason.code),
    ).toEqual(["REVIEW_IMAGE_VERSION_CONFLICT"]);
    expect(
      await prisma.review.findUnique({ where: { id: review.id }, select: { imageVersion: true } }),
    ).toEqual({
      imageVersion: 1,
    });
  });

  it("replaces three images and then atomically clears the set", async () => {
    const { user, review } = await createReviewFixture();
    const fake = storage();
    const deps: ReviewImageSyncDeps = { storage: fake.storage, urlTtlSeconds: 60 };
    const first = await syncReviewImages(
      deps,
      user.id,
      review.id,
      "sync-three",
      {
        expectedVersion: 0,
        items: [0, 1, 2].map((index) => ({
          kind: "new" as const,
          clientId: `new-${index}`,
          fileIndex: index,
        })),
      },
      [await inputFile("one"), await inputFile("two"), await inputFile("three")],
    );
    const replacement = await syncReviewImages(
      deps,
      user.id,
      review.id,
      "sync-replace",
      {
        expectedVersion: 1,
        items: [
          { kind: "existing" as const, clientId: "kept-1", imageId: first.images[2].id },
          { kind: "new" as const, clientId: "replacement", fileIndex: 0 },
        ],
      },
      [await inputFile("replacement")],
    );
    const cleared = await syncReviewImages(
      deps,
      user.id,
      review.id,
      "sync-clear",
      {
        expectedVersion: 2,
        items: [],
      },
      [],
    );

    expect(replacement.imageVersion).toBe(2);
    expect(replacement.images.map((image) => image.position)).toEqual([0, 1]);
    expect(cleared).toMatchObject({ imageVersion: 3, images: [] });
    expect(
      await prisma.reviewImage.count({
        where: { reviewId: review.id, status: "READY", deletedAt: null },
      }),
    ).toBe(0);
  });

  it("keeps the active set unchanged when replacement storage fails", async () => {
    const { user, review } = await createReviewFixture();
    const fake = storage();
    const deps: ReviewImageSyncDeps = { storage: fake.storage, urlTtlSeconds: 60 };
    const first = await syncReviewImages(
      deps,
      user.id,
      review.id,
      "sync-original",
      {
        expectedVersion: 0,
        items: [{ kind: "new", clientId: "original", fileIndex: 0 }],
      },
      [await inputFile("original")],
    );
    fake.storage.putObject = async () => {
      throw new Error("storage down");
    };

    await expect(
      syncReviewImages(
        deps,
        user.id,
        review.id,
        "sync-failed-replacement",
        {
          expectedVersion: 1,
          items: [{ kind: "new", clientId: "replacement", fileIndex: 0 }],
        },
        [await inputFile("replacement")],
      ),
    ).rejects.toMatchObject({
      code: "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
    });

    expect(
      await prisma.review.findUnique({ where: { id: review.id }, select: { imageVersion: true } }),
    ).toEqual({
      imageVersion: 1,
    });
    expect(
      await prisma.reviewImage.findMany({
        where: { reviewId: review.id, status: "READY", deletedAt: null },
        select: { id: true },
      }),
    ).toEqual([{ id: first.images[0].id }]);
  });
});
