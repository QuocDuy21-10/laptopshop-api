import { createReviewImageSyncFingerprint } from "modules/reviews/review-image-sync.fingerprint";
import type { ReviewImageSyncManifest } from "modules/reviews/review-image-sync.types";

const file = (buffer: Buffer, mimetype = "image/png") =>
  ({ buffer, mimetype, size: buffer.length }) as Express.Multer.File;

const manifest: ReviewImageSyncManifest = {
  expectedVersion: 4,
  items: [{ kind: "new", clientId: "new-c", fileIndex: 0 }],
};

describe("review image sync fingerprint", () => {
  it("is stable for the same review, manifest and raw file", () => {
    expect(createReviewImageSyncFingerprint(18, manifest, [file(Buffer.from("png"))])).toBe(
      createReviewImageSyncFingerprint(18, manifest, [file(Buffer.from("png"))]),
    );
  });

  it.each([
    ["review ID", 19, manifest, [file(Buffer.from("png"))]],
    ["expected version", 18, { ...manifest, expectedVersion: 5 }, [file(Buffer.from("png"))]],
    [
      "item order",
      18,
      { ...manifest, items: [{ kind: "new", clientId: "other", fileIndex: 0 }] },
      [file(Buffer.from("png"))],
    ],
    ["file bytes", 18, manifest, [file(Buffer.from("jpeg"))]],
    ["file MIME", 18, manifest, [file(Buffer.from("png"), "image/jpeg")]],
  ] as const)("changes when %s changes", (_label, reviewId, nextManifest, files) => {
    expect(createReviewImageSyncFingerprint(18, manifest, [file(Buffer.from("png"))])).not.toBe(
      createReviewImageSyncFingerprint(reviewId, nextManifest, files),
    );
  });
});
