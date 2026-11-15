import fs from "fs";
import path from "path";

import { UPLOADED_NAME, fakeMediaStorage } from "../helpers/media-storage";
import {
  MEDIA_DIRS,
  configureMediaStorage,
  readMediaImage,
  removeMediaImage,
  saveMediaImage,
} from "lib/storage/media-images";

afterEach(() => configureMediaStorage(null));

describe("media images on object storage", () => {
  it("stores a webp under its directory key", async () => {
    const storage = fakeMediaStorage();
    configureMediaStorage(storage);
    const body = Buffer.from("webp");
    await saveMediaImage(MEDIA_DIRS.product, UPLOADED_NAME, body);
    expect(storage.putObject).toHaveBeenCalledWith({
      key: `images/product/${UPLOADED_NAME}`,
      body,
      contentLength: 4,
      contentType: "image/webp",
    });
  });

  it("reads through the configured storage", async () => {
    const storage = fakeMediaStorage();
    configureMediaStorage(storage);
    await readMediaImage(MEDIA_DIRS.banner, UPLOADED_NAME);
    expect(storage.getObject).toHaveBeenCalledWith(`images/banner/${UPLOADED_NAME}`);
  });

  it("deletes an uploaded image", async () => {
    const storage = fakeMediaStorage();
    configureMediaStorage(storage);
    await removeMediaImage(MEDIA_DIRS.avatar, UPLOADED_NAME);
    expect(storage.deleteObject).toHaveBeenCalledWith(`images/${UPLOADED_NAME}`);
  });

  it.each([null, undefined, "1711078092373-asus-01.png", "noAvatar.jpg", `../${UPLOADED_NAME}`])(
    "never deletes %s",
    async (name) => {
      const storage = fakeMediaStorage();
      configureMediaStorage(storage);
      await removeMediaImage(MEDIA_DIRS.product, name);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    },
  );

  it("swallows a failed delete", async () => {
    const storage = fakeMediaStorage();
    storage.deleteObject.mockRejectedValue(new Error("r2 down"));
    configureMediaStorage(storage);
    await expect(removeMediaImage(MEDIA_DIRS.banner, UPLOADED_NAME)).resolves.toBeUndefined();
  });
});

describe("media images on disk", () => {
  const file = path.join("public", MEDIA_DIRS.product, UPLOADED_NAME);
  afterEach(() => fs.rmSync(file, { force: true }));

  it("writes and removes the file under public/", async () => {
    await saveMediaImage(MEDIA_DIRS.product, UPLOADED_NAME, Buffer.from("webp"));
    expect(fs.readFileSync(file).toString()).toBe("webp");
    await removeMediaImage(MEDIA_DIRS.product, UPLOADED_NAME);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("does not fail when the file is already gone", async () => {
    await expect(removeMediaImage(MEDIA_DIRS.product, UPLOADED_NAME)).resolves.toBeUndefined();
  });

  it("returns null when reading without object storage", async () => {
    await expect(readMediaImage(MEDIA_DIRS.product, UPLOADED_NAME)).resolves.toBeNull();
  });
});
