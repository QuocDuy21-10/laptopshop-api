jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/reviews/review-images.service", () => ({
  addReviewImages: jest.fn(),
  reorderReviewImages: jest.fn(),
  deleteReviewImage: jest.fn(),
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
});

describe("review image routes", () => {
  it("rejects unauthenticated upload before processing the multipart body", async () => {
    const res = await request(buildApp())
      .post("/api/v1/reviews/18/images")
      .attach("images", Buffer.from("x"), "x.png");

    expect(res.status).toBe(401);
    expect(addReviewImages).not.toHaveBeenCalled();
  });

  it("checks owner before Multer and forwards multiple files", async () => {
    prismaMock.review.findFirst.mockResolvedValue({ id: 18, status: "PUBLISHED", deletedAt: null });
    jest
      .mocked(addReviewImages)
      .mockResolvedValue([
        {
          id: 21,
          mimeType: "image/webp",
          byteSize: 10,
          width: 10,
          height: 10,
          position: 0,
          status: "READY",
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
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
    expect(reorderReviewImages).toHaveBeenCalledWith(USER.id, 18, [21, 22]);
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
});
