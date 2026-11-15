import { Readable } from "stream";
import request from "supertest";

import { buildApp } from "../helpers/app";
import { UPLOADED_NAME, fakeMediaStorage } from "../helpers/media-storage";

const stored = () => ({
  body: Readable.from([Buffer.from("webp-bytes")]),
  contentType: "image/webp",
  contentLength: 10,
  etag: '"etag-1"',
});

describe("GET /images/* from object storage", () => {
  it("streams an uploaded image with long-lived cache headers", async () => {
    const storage = fakeMediaStorage();
    storage.getObject.mockResolvedValue(stored());
    const res = await request(buildApp({ mediaImages: storage })).get(
      `/images/product/${UPLOADED_NAME}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers.etag).toBe('"etag-1"');
    expect(Buffer.from(res.body).toString()).toBe("webp-bytes");
    expect(storage.getObject).toHaveBeenCalledWith(`images/product/${UPLOADED_NAME}`);
  });

  it.each([
    [`/images/banner/${UPLOADED_NAME}`, `images/banner/${UPLOADED_NAME}`],
    [`/images/${UPLOADED_NAME}`, `images/${UPLOADED_NAME}`],
  ])("maps %s to key %s", async (url, key) => {
    const storage = fakeMediaStorage();
    storage.getObject.mockResolvedValue(stored());
    const res = await request(buildApp({ mediaImages: storage })).get(url);
    expect(res.status).toBe(200);
    expect(storage.getObject).toHaveBeenCalledWith(key);
  });

  it("answers 304 when the browser already has the image", async () => {
    const storage = fakeMediaStorage();
    storage.getObject.mockResolvedValue(stored());
    const res = await request(buildApp({ mediaImages: storage }))
      .get(`/images/product/${UPLOADED_NAME}`)
      .set("If-None-Match", '"etag-1"');
    expect(res.status).toBe(304);
  });

  it.each([
    "/images/product/not-a-uuid.webp",
    `/images/product/${UPLOADED_NAME.replace(".webp", ".png")}`,
    `/images/reviews/${UPLOADED_NAME}`,
    `/images/product/sub/${UPLOADED_NAME}`,
  ])("returns 404 for %s without reading the bucket", async (url) => {
    const storage = fakeMediaStorage();
    const res = await request(buildApp({ mediaImages: storage })).get(url);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("returns 404 when the object does not exist", async () => {
    const storage = fakeMediaStorage();
    const res = await request(buildApp({ mediaImages: storage })).get(
      `/images/product/${UPLOADED_NAME}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("serves bundled seed images from disk without reading the bucket", async () => {
    const storage = fakeMediaStorage();
    const res = await request(buildApp({ mediaImages: storage })).get(
      "/images/product/1711078092373-asus-01.png",
    );
    expect(res.status).toBe(200);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("is not mounted when media storage is disabled", async () => {
    const res = await request(buildApp()).get(`/images/product/${UPLOADED_NAME}`);
    expect(res.status).toBe(404);
  });
});
