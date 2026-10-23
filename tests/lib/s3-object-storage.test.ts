import { createS3ObjectStorage } from "lib/storage/s3-object-storage";

describe("S3 object storage", () => {
  it("returns null when image storage is disabled", () => {
    expect(createS3ObjectStorage({ enabled: false })).toBeNull();
  });
});
