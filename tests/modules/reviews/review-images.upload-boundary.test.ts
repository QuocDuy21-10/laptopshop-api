jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/reviews/review-images.service", () => ({
  addReviewImages: jest.fn(async (_deps, _userId, _reviewId, files) => {
    await Promise.all(
      files.map(require("modules/reviews/review-images.processor").processReviewImage),
    );
    return [];
  }),
}));
jest.mock("modules/reviews/review-image-sync.service", () => ({
  syncReviewImages: jest.fn(async (_deps, _userId, reviewId, _key, _manifest, files) => {
    await Promise.all(
      files.map(require("modules/reviews/review-images.processor").processReviewImage),
    );
    return { reviewId, imageVersion: 1, replayed: false, images: [] };
  }),
}));

import sharp from "sharp";
import request from "supertest";

import { buildApp } from "../../helpers/app";
import { cookieFor, USER } from "../../helpers/auth";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

const storage = {
  putObject: jest.fn(),
  deleteObject: jest.fn(),
  objectExists: jest.fn(),
  getSignedReadUrl: jest.fn(),
};
let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
    .png()
    .toBuffer();
});
beforeEach(() => {
  resetPrisma();
  prismaMock.review.findFirst.mockResolvedValue({ id: 18 });
});

describe.each(["post", "put"] as const)("review image %s multipart size boundary", (method) => {
  it.each([3_145_727, 3_145_728, 3_145_729])(
    "checks a decodable %i-byte image inclusively",
    async (size) => {
      const app = buildApp({ reviewImages: { storage } });
      const upload = request(app)
        [method](`/api/v1/reviews/18/images${method === "put" ? "/sync" : ""}`)
        .set("Cookie", cookieFor(USER));
      if (method === "put")
        upload
          .set("Idempotency-Key", "boundary")
          .field(
            "manifest",
            JSON.stringify({
              expectedVersion: 0,
              items: [{ kind: "new", clientId: "one", fileIndex: 0 }],
            }),
          );
      const response = await upload.attach(
        method === "put" ? "files" : "images",
        Buffer.concat([png, Buffer.alloc(size - png.length)]),
        { filename: "boundary.png", contentType: "image/png" },
      );
      expect(response.status).toBe(size <= 3_145_728 ? (method === "post" ? 201 : 200) : 413);
      if (size > 3_145_728) expect(response.body.error.code).toBe("REVIEW_IMAGE_TOO_LARGE");
      expect(storage.putObject).not.toHaveBeenCalled();
    },
  );
});
