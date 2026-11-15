jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import request from "supertest";

import { buildApp } from "../helpers/app";
import { ADMIN, USER, cookieFor } from "../helpers/auth";
import { prismaMock, resetPrisma } from "../helpers/prisma";
import { PNG_1PX, fakeMediaStorage } from "../helpers/media-storage";

const user = {
  id: 1,
  username: "a@b.co",
  fullName: "A",
  address: null,
  phone: null,
  accountType: "SYSTEM",
  avatar: null,
  role: { id: 2, name: "USER" },
};

beforeEach(resetPrisma);

describe("image upload middleware with object storage", () => {
  it("converts the upload to webp and stores it in the bucket", async () => {
    const storage = fakeMediaStorage();
    prismaMock.user.update.mockImplementation(async (args: any) => ({
      ...user,
      avatar: args.data.avatar,
    }));

    const res = await request(buildApp({ mediaImages: storage }))
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .attach("avatar", PNG_1PX, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.data.avatar).toMatch(/^\/images\/[0-9a-f-]{36}\.webp$/);
    const put = storage.putObject.mock.calls[0][0];
    expect(put.key).toBe(res.body.data.avatar.slice(1));
    expect(put.contentType).toBe("image/webp");
    expect(put.body.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects non-image bytes without touching the bucket", async () => {
    const storage = fakeMediaStorage();
    const res = await request(buildApp({ mediaImages: storage }))
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .attach("avatar", Buffer.from("not an image"), {
        filename: "x.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE");
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("reports a corrupt PNG as INVALID_FILE", async () => {
    const storage = fakeMediaStorage();
    // passes the magic-byte check, then fails inside sharp
    const corrupt = Buffer.concat([PNG_1PX.subarray(0, 8), Buffer.from("garbage")]);
    const res = await request(buildApp({ mediaImages: storage }))
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .attach("avatar", corrupt, { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE");
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("deletes the stored image when the request fails afterwards", async () => {
    const storage = fakeMediaStorage();
    prismaMock.homeBanner.findUnique.mockResolvedValue(null);

    const res = await request(buildApp({ mediaImages: storage }))
      .post("/api/v1/admin/home-banners/9/image")
      .set("Cookie", cookieFor(ADMIN))
      .field("imageAlt", "x")
      .attach("image", PNG_1PX, { filename: "hero.png", contentType: "image/png" });

    expect(res.status).toBe(404);
    const key = storage.putObject.mock.calls[0][0].key;
    expect(key).toMatch(/^images\/banner\/[0-9a-f-]{36}\.webp$/);
    expect(storage.deleteObject).toHaveBeenCalledWith(key);
  });
});
