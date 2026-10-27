jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import fs from "fs";
import path from "path";
import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

const row = {
  id: 1,
  username: "a@b.co",
  fullName: "A",
  address: null,
  phone: null,
  accountType: "SYSTEM",
  avatar: null,
  role: { id: 2, name: "USER" },
};
// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

beforeEach(resetPrisma);

describe("GET /api/v1/users/me", () => {
  it("returns 401 without a session", async () => {
    expect((await request(buildApp()).get("/api/v1/users/me")).status).toBe(401);
  });

  it("returns the current user with the cart item count", async () => {
    prismaMock.user.findUnique.mockResolvedValue(row);
    prismaMock.cartDetail.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });
    const res = await request(buildApp()).get("/api/v1/users/me").set("Cookie", cookieFor(USER));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 1, role: "USER", cartItemCount: 3 });
    expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({ id: USER.id });
  });
});

describe("PATCH /api/v1/users/me", () => {
  it("updates profile fields from JSON", async () => {
    prismaMock.user.update.mockResolvedValue({ ...row, fullName: "New" });
    const res = await request(buildApp())
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .send({ fullName: "New", phone: "0900000000", role: "ADMIN" });
    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe("New");
    expect(prismaMock.user.update.mock.calls[0][0]).toMatchObject({
      where: { id: USER.id },
      data: { fullName: "New", phone: "0900000000" },
    });
    expect(prismaMock.user.update.mock.calls[0][0].data).not.toHaveProperty("role");
  });

  it("stores an uploaded avatar", async () => {
    prismaMock.user.update.mockImplementation(async (args: any) => ({
      ...row,
      avatar: args.data.avatar,
    }));
    const res = await request(buildApp())
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .field("fullName", "With Avatar")
      .attach("avatar", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.data.avatar).toMatch(/^\/images\/.+\.png$/);
    fs.unlinkSync(path.join("public", res.body.data.avatar));
  });

  it("rejects a non-image avatar with 400", async () => {
    const res = await request(buildApp())
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .attach("avatar", Buffer.from("hi"), { filename: "a.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE");
  });

  it("rejects non-image bytes sent with an image MIME type and stores nothing", async () => {
    const before = fs.readdirSync("public/images");
    const res = await request(buildApp())
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .attach("avatar", Buffer.from("not an image"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE");
    expect(fs.readdirSync("public/images")).toEqual(before);
  });

  it("names the stored file from its content, not the client filename", async () => {
    prismaMock.user.update.mockImplementation(async (args: any) => ({
      ...row,
      avatar: args.data.avatar,
    }));
    const res = await request(buildApp())
      .patch("/api/v1/users/me")
      .set("Cookie", cookieFor(USER))
      .attach("avatar", PNG, { filename: "../../a.png.php", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.data.avatar).toMatch(/^\/images\/[0-9a-f-]{36}\.png$/);
    fs.unlinkSync(path.join("public", res.body.data.avatar));
  });
});
