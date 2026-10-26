jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/reviews/review-images.service", () => ({
  addReviewImages: jest.fn(),
  reorderReviewImages: jest.fn(),
  deleteReviewImage: jest.fn(),
  syncReviewImages: jest.fn(),
  getReviewImageSyncStatus: jest.fn(),
}));
jest.mock("modules/reviews/review-image-sync.service", () => ({
  syncReviewImages: jest.fn(),
  getReviewImageSyncStatus: jest.fn(),
}));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { cookieFor, USER } from "../../helpers/auth";
import {
  addReviewImages,
  deleteReviewImage,
  reorderReviewImages,
} from "modules/reviews/review-images.service";
import {
  getReviewImageSyncStatus,
  syncReviewImages,
} from "modules/reviews/review-image-sync.service";

const storage = {
  putObject: jest.fn(),
  deleteObject: jest.fn(),
  objectExists: jest.fn(),
  getSignedReadUrl: jest.fn(),
};

beforeEach(() => {
  resetPrisma();
  jest.mocked(addReviewImages).mockReset();
  jest.mocked(reorderReviewImages).mockReset();
  jest.mocked(deleteReviewImage).mockReset();
  jest.mocked(syncReviewImages).mockReset();
  jest.mocked(getReviewImageSyncStatus).mockReset();
});

describe("review image routes", () => {
  it("rejects unauthenticated upload before processing the multipart body", async () => {
    const res = await request(buildApp({ reviewImages: { storage } } as never))
      .post("/api/v1/reviews/18/images")
      .attach("images", Buffer.from("x"), "x.png");

    expect(res.status).toBe(401);
    expect(addReviewImages).not.toHaveBeenCalled();
  });

  it("checks owner before Multer and forwards multiple files", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ id: 18, status: "PUBLISHED", deletedAt: null });
    jest.mocked(addReviewImages).mockResolvedValue([
      {
        id: 21,
        url: "https://signed.test/21.webp",
        urlExpiresAt: "2026-10-21T01:15:00.000Z",
        mimeType: "image/webp",
        width: 10,
        height: 10,
        position: 0,
      },
    ]);

    const res = await request(buildApp({ reviewImages: { storage } } as never))
      .post("/api/v1/reviews/18/images")
      .set("Cookie", cookieFor(USER))
      .attach("images", Buffer.from("one"), "one.png")
      .attach("images", Buffer.from("two"), "two.png");

    expect(res.status).toBe(201);
    expect(addReviewImages).toHaveBeenCalledWith(
      expect.objectContaining({ storage }),
      USER.id,
      18,
      expect.any(Array),
    );
    expect(prismaMock.review.findFirst).toHaveBeenCalled();
  });

  it("returns owner-not-found without invoking the processor service", async () => {
    prismaMock.review.findFirst.mockResolvedValue(null);

    const res = await request(buildApp({ reviewImages: { storage } } as never))
      .post("/api/v1/reviews/18/images")
      .set("Cookie", cookieFor(USER))
      .attach("images", Buffer.from("one"), "one.png");

    expect(res.status).toBe(404);
    expect(addReviewImages).not.toHaveBeenCalled();
  });

  it("rejects a strict reorder body and forwards a valid one", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ id: 18, status: "HIDDEN", deletedAt: null });
    jest.mocked(reorderReviewImages).mockResolvedValue([]);

    const invalid = await request(buildApp({ reviewImages: { storage } } as never))
      .patch("/api/v1/reviews/18/images/order")
      .set("Cookie", cookieFor(USER))
      .send({ imageIds: [21], extra: true });
    expect(invalid.status).toBe(400);

    const valid = await request(buildApp({ reviewImages: { storage } } as never))
      .patch("/api/v1/reviews/18/images/order")
      .set("Cookie", cookieFor(USER))
      .send({ imageIds: [21, 22] });
    expect(valid.status).toBe(200);
    expect(reorderReviewImages).toHaveBeenCalledWith(
      expect.objectContaining({ storage }),
      USER.id,
      18,
      [21, 22],
    );
  });

  it("deletes an owned image with 204", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ id: 18, status: "PUBLISHED", deletedAt: null });
    jest.mocked(deleteReviewImage).mockResolvedValue(undefined);

    const res = await request(buildApp({ reviewImages: { storage } } as never))
      .delete("/api/v1/reviews/18/images/21")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(204);
    expect(deleteReviewImage).toHaveBeenCalledWith(
      expect.objectContaining({ storage }),
      USER.id,
      18,
      21,
    );
  });

  it("requires an idempotency key for sync", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ id: 18, status: "PUBLISHED", deletedAt: null });
    const res = await request(buildApp({ reviewImages: { storage, urlTtlSeconds: 60 } as never }))
      .put("/api/v1/reviews/18/images/sync")
      .set("Cookie", cookieFor(USER))
      .field("manifest", JSON.stringify({ expectedVersion: 0, items: [] }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(syncReviewImages).not.toHaveBeenCalled();
  });

  it("forwards the ordered sync manifest and files to the owner service", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ id: 18, status: "PUBLISHED", deletedAt: null });
    jest.mocked(syncReviewImages).mockResolvedValue({
      reviewId: 18,
      imageVersion: 1,
      replayed: false,
      images: [],
    });
    const manifest = {
      expectedVersion: 0,
      items: [{ kind: "new", clientId: "one", fileIndex: 0 }],
    };

    const res = await request(buildApp({ reviewImages: { storage, urlTtlSeconds: 60 } as never }))
      .put("/api/v1/reviews/18/images/sync")
      .set("Cookie", cookieFor(USER))
      .set("Idempotency-Key", "sync-key")
      .field("manifest", JSON.stringify(manifest))
      .attach("files", Buffer.from("one"), "one.png");

    expect(res.status).toBe(200);
    expect(syncReviewImages).toHaveBeenCalledWith(
      expect.objectContaining({ storage }),
      USER.id,
      18,
      "sync-key",
      manifest,
      expect.any(Array),
    );
  });

  it("returns operation status through the owner-only status endpoint", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ id: 18, status: "PUBLISHED", deletedAt: null });
    jest.mocked(getReviewImageSyncStatus).mockResolvedValue({
      reviewId: 18,
      status: "WAITING_RETRY",
      expectedVersion: 0,
      retryable: true,
      updatedAt: "2026-10-21T01:00:00.000Z",
    });

    const res = await request(buildApp({ reviewImages: { storage, urlTtlSeconds: 60 } as never }))
      .get("/api/v1/reviews/18/images/sync")
      .set("Cookie", cookieFor(USER))
      .set("Idempotency-Key", "sync-key");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("WAITING_RETRY");
    expect(getReviewImageSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({ storage }),
      USER.id,
      18,
      "sync-key",
    );
  });
});
