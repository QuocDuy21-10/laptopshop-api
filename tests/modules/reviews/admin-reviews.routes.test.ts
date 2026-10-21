jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { ADMIN, cookieFor, USER } from "../../helpers/auth";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";

const adminReviewRow = {
  id: 18,
  userId: 1,
  productId: 12,
  orderDetailId: 91,
  rating: 5,
  title: "Ổn định",
  content: "Máy chạy ổn định cho công việc hằng ngày.",
  isAnonymous: true,
  status: "PUBLISHED" as const,
  deletedAt: null,
  createdAt: new Date("2026-10-21T03:00:00.000Z"),
  contentUpdatedAt: new Date("2026-10-21T04:00:00.000Z"),
  hiddenReason: null,
  moderatedAt: null,
  user: { id: 1, username: "buyer@test.local", fullName: "Nguyễn Văn A" },
  product: { id: 12, name: "Asus Zenbook" },
  orderDetail: {
    id: 91,
    order: {
      id: 45,
      status: "COMPLETED",
      paymentStatus: "PAYMENT_SUCCESS",
      completedAt: new Date("2026-10-20T03:00:00.000Z"),
    },
  },
  moderatedBy: null,
};

beforeEach(() => {
  resetPrisma();
  prismaMock.$queryRaw.mockResolvedValue([{ id: 18, status: "PUBLISHED", deletedAt: null }]);
});

describe("admin review routes", () => {
  it("rejects non-admins", async () => {
    const res = await request(buildApp())
      .get("/api/v1/admin/reviews")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(403);
  });

  it("filters reviews and maps purchase evidence without receiver/payment payload", async () => {
    prismaMock.review.count.mockResolvedValue(1);
    prismaMock.review.findMany.mockResolvedValue([adminReviewRow]);

    const res = await request(buildApp())
      .get(
        "/api/v1/admin/reviews?productId=12&rating=5&status=HIDDEN&deleted=false&q=Asus&from=2026-10-01&to=2026-10-31",
      )
      .set("Cookie", cookieFor(ADMIN));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      author: { id: 1, username: "buyer@test.local" },
      product: { id: 12, name: "Asus Zenbook" },
      purchase: { orderId: 45, orderDetailId: 91, paymentStatus: "PAYMENT_SUCCESS" },
    });
    expect(res.body.data[0]).not.toHaveProperty("receiverAddress");
    expect(prismaMock.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: 12,
          rating: 5,
          status: "HIDDEN",
          deletedAt: null,
          createdAt: {
            gte: new Date("2026-09-30T17:00:00.000Z"),
            lt: new Date("2026-10-31T17:00:00.000Z"),
          },
        }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("rejects an admin date range that is reversed", async () => {
    const res = await request(buildApp())
      .get("/api/v1/admin/reviews?from=2026-10-21&to=2026-10-20")
      .set("Cookie", cookieFor(ADMIN));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(prismaMock.review.findMany).not.toHaveBeenCalled();
  });

  it("returns summary with average limited to active public reviews", async () => {
    prismaMock.review.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prismaMock.review.groupBy.mockResolvedValue([
      { rating: 5, _count: { _all: 2 } },
      { rating: 4, _count: { _all: 1 } },
    ]);

    const res = await request(buildApp())
      .get("/api/v1/admin/reviews/summary")
      .set("Cookie", cookieFor(ADMIN));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totalReviews: 5,
      publishedReviews: 3,
      hiddenReviews: 2,
      deletedReviews: 1,
      averageRating: 4.7,
    });
  });

  it("returns admin detail with author and purchase evidence", async () => {
    prismaMock.review.findUnique.mockResolvedValue(adminReviewRow);

    const res = await request(buildApp())
      .get("/api/v1/admin/reviews/18")
      .set("Cookie", cookieFor(ADMIN));

    expect(res.status).toBe(200);
    expect(res.body.data.purchase.orderId).toBe(45);
    expect(res.body.data.author.fullName).toBe("Nguyễn Văn A");
    expect(res.body.data).not.toHaveProperty("receiverPhone");
  });

  it("requires a reason to hide a review", async () => {
    const res = await request(buildApp())
      .patch("/api/v1/admin/reviews/18/moderation")
      .set("Cookie", cookieFor(ADMIN))
      .send({ status: "HIDDEN" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("hides a review with actor, reason and timestamp", async () => {
    prismaMock.review.findUnique.mockResolvedValueOnce(adminReviewRow).mockResolvedValueOnce({
      ...adminReviewRow,
      status: "HIDDEN",
      hiddenReason: "Không phù hợp",
      moderatedById: ADMIN.id,
    });
    prismaMock.review.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.review.findUnique.mockResolvedValue({
      ...adminReviewRow,
      status: "HIDDEN",
      hiddenReason: "Không phù hợp",
      moderatedById: ADMIN.id,
    });

    const res = await request(buildApp())
      .patch("/api/v1/admin/reviews/18/moderation")
      .set("Cookie", cookieFor(ADMIN))
      .send({ status: "HIDDEN", reason: "Không phù hợp" });

    expect(res.status).toBe(200);
    expect(prismaMock.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 18, deletedAt: null, status: "PUBLISHED" },
        data: expect.objectContaining({
          status: "HIDDEN",
          hiddenReason: "Không phù hợp",
          moderatedById: ADMIN.id,
        }),
      }),
    );
  });

  it("restores a hidden review and clears its reason", async () => {
    const hidden = {
      ...adminReviewRow,
      status: "HIDDEN" as const,
      hiddenReason: "Không phù hợp",
      moderatedAt: new Date(),
    };
    prismaMock.review.findUnique
      .mockResolvedValueOnce(hidden)
      .mockResolvedValueOnce({ ...adminReviewRow, status: "PUBLISHED", hiddenReason: null });
    prismaMock.$queryRaw.mockResolvedValue([{ id: 18, status: "HIDDEN", deletedAt: null }]);
    prismaMock.review.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.review.findUnique.mockResolvedValue({
      ...adminReviewRow,
      status: "PUBLISHED",
      hiddenReason: null,
    });

    const res = await request(buildApp())
      .patch("/api/v1/admin/reviews/18/moderation")
      .set("Cookie", cookieFor(ADMIN))
      .send({ status: "PUBLISHED" });

    expect(res.status).toBe(200);
    expect(prismaMock.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 18, deletedAt: null, status: "HIDDEN" },
        data: expect.objectContaining({ status: "PUBLISHED", hiddenReason: null }),
      }),
    );
  });

  it("does not update moderation metadata for a public-on-public request", async () => {
    prismaMock.review.findUnique.mockResolvedValue(adminReviewRow);

    const res = await request(buildApp())
      .patch("/api/v1/admin/reviews/18/moderation")
      .set("Cookie", cookieFor(ADMIN))
      .send({ status: "PUBLISHED" });

    expect(res.status).toBe(200);
    expect(prismaMock.review.update).not.toHaveBeenCalled();
  });

  it("updates the reason for a hidden-on-hidden request", async () => {
    const hidden = { ...adminReviewRow, status: "HIDDEN" as const, hiddenReason: "Cũ" };
    prismaMock.review.findUnique
      .mockResolvedValueOnce(hidden)
      .mockResolvedValueOnce({ ...hidden, hiddenReason: "Mới" });
    prismaMock.$queryRaw.mockResolvedValue([{ id: 18, status: "HIDDEN", deletedAt: null }]);
    prismaMock.review.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.review.findUnique.mockResolvedValue({ ...hidden, hiddenReason: "Mới" });

    const res = await request(buildApp())
      .patch("/api/v1/admin/reviews/18/moderation")
      .set("Cookie", cookieFor(ADMIN))
      .send({ status: "HIDDEN", reason: "Mới" });

    expect(res.status).toBe(200);
    expect(prismaMock.review.updateMany).toHaveBeenCalled();
  });

  it("returns a conflict when moderation loses the review state race", async () => {
    prismaMock.review.findUnique.mockResolvedValue(adminReviewRow);
    prismaMock.review.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(buildApp())
      .patch("/api/v1/admin/reviews/18/moderation")
      .set("Cookie", cookieFor(ADMIN))
      .send({ status: "HIDDEN", reason: "Không phù hợp" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_STATE_CHANGED");
    expect(prismaMock.review.findUnique).toHaveBeenCalledTimes(1);
  });

  it("cannot restore a deleted review", async () => {
    prismaMock.review.findUnique.mockResolvedValue({ ...adminReviewRow, deletedAt: new Date() });

    const res = await request(buildApp())
      .patch("/api/v1/admin/reviews/18/moderation")
      .set("Cookie", cookieFor(ADMIN))
      .send({ status: "PUBLISHED" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_DELETED");
  });
});
