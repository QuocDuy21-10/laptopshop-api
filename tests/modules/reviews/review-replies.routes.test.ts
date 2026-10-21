jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { ADMIN, cookieFor, USER } from "../../helpers/auth";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const reply = {
  id: 31,
  reviewId: 18,
  content: "LaptopShop cảm ơn bạn đã chia sẻ.",
  createdAt: new Date("2026-10-21T03:00:00.000Z"),
  updatedAt: new Date("2026-10-21T04:00:00.000Z"),
  deletedAt: null,
  createdBy: { id: 7, username: "admin@test.local", fullName: "Admin" },
  updatedBy: { id: 7, username: "admin@test.local", fullName: "Admin" },
};

beforeEach(() => {
  resetPrisma();
  prismaMock.$queryRaw.mockResolvedValue([{ id: 18, status: "HIDDEN", deletedAt: null }]);
  prismaMock.reviewReply.upsert.mockResolvedValue(reply);
  prismaMock.reviewReply.findUniqueOrThrow.mockResolvedValue(reply);
  prismaMock.reviewReply.updateMany.mockResolvedValue({ count: 1 });
});

describe("official review reply routes", () => {
  it("rejects non-admins", async () => {
    const res = await request(buildApp())
      .put("/api/v1/admin/reviews/18/reply")
      .set("Cookie", cookieFor(USER))
      .send({ content: "Phản hồi chính thức" });

    expect(res.status).toBe(403);
  });

  it("upserts a trimmed reply on a hidden review without exposing secrets", async () => {
    const res = await request(buildApp())
      .put("/api/v1/admin/reviews/18/reply")
      .set("Cookie", cookieFor(ADMIN))
      .send({ content: "  LaptopShop cảm ơn bạn đã chia sẻ.  " });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 31, content: reply.content });
    expect(res.body.data).not.toHaveProperty("createdById");
    expect(prismaMock.reviewReply.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reviewId: 18 },
        create: expect.objectContaining({ createdById: ADMIN.id, updatedById: ADMIN.id }),
        update: expect.objectContaining({ deletedAt: null, updatedById: ADMIN.id }),
      }),
    );
  });

  it("returns a conflict for a deleted review", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 18, status: "PUBLISHED", deletedAt: new Date() }]);
    const res = await request(buildApp())
      .put("/api/v1/admin/reviews/18/reply")
      .set("Cookie", cookieFor(ADMIN))
      .send({ content: "Phản hồi chính thức" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_DELETED");
    expect(prismaMock.reviewReply.upsert).not.toHaveBeenCalled();
  });

  it("soft-deletes idempotently", async () => {
    const first = await request(buildApp())
      .delete("/api/v1/admin/reviews/18/reply")
      .set("Cookie", cookieFor(ADMIN));
    const second = await request(buildApp())
      .delete("/api/v1/admin/reviews/18/reply")
      .set("Cookie", cookieFor(ADMIN));

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(prismaMock.reviewReply.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reviewId: 18, deletedAt: null } }),
    );
  });
});
