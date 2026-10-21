import { randomUUID } from "node:crypto";
import { env } from "config/env";
import { createReviewImageStorage } from "lib/storage/s3-review-image-storage";

describe("review image storage integration", () => {
  it("puts, reads and idempotently deletes a review image object", async () => {
    const storage = createReviewImageStorage(env);
    if (!storage) throw new Error("Review image storage is not enabled for integration tests");

    const body = Buffer.from("review-image-storage-integration");
    const key = `tests/${randomUUID()}.webp`;
    await storage.putObject({ key, body, contentLength: body.length });

    try {
      await expect(storage.objectExists(key)).resolves.toBe(true);
      const response = await fetch(await storage.getSignedReadUrl(key, 60));
      expect(response.ok).toBe(true);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
    } finally {
      await storage.deleteObject(key);
      await storage.deleteObject(key);
    }

    await expect(storage.objectExists(key)).resolves.toBe(false);
  });
});
