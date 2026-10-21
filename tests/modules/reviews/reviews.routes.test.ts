jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { cookieFor, USER } from "../../helpers/auth";

const reviewRow = {
  id: 18,
  productId: 12,
  rating: 5,
  title: "Ổn định",
  content: "Máy chạy ổn định cho công việc hằng ngày.",
  isAnonymous: true,
  createdAt: new Date("2026-10-21T03:00:00.000Z"),
  contentUpdatedAt: new Date("2026-10-21T04:00:00.000Z"),
  user: { fullName: "Nguyễn Văn A" },
};

const ownerReviewRow = {
  id: 18,
  productId: 12,
  rating: 5,
  title: "Ổn định",
  content: "Máy chạy ổn định cho công việc hằng ngày.",
  isAnonymous: true,
  status: "PUBLISHED" as const,
  deletedAt: null,
  createdAt: new Date("2026-10-21T03:00:00.000Z"),
  contentUpdatedAt: new Date("2026-10-21T04:00:00.000Z"),
};

const hiddenOwnerReviewRow = { ...ownerReviewRow, status: "HIDDEN" as const };
const deletedOwnerReviewRow = {
  ...ownerReviewRow,
  deletedAt: new Date("2026-10-20T03:00:00.000Z"),
};

beforeEach(resetPrisma);

describe("GET /api/v1/products/:id/reviews", () => {
  it("lists only public reviews with a stable newest sort", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.count.mockResolvedValue(1);
    prismaMock.review.findMany.mockResolvedValue([reviewRow]);

    const res = await request(buildApp()).get("/api/v1/products/12/reviews?page=2&pageSize=5");

    expect(res.status).toBe(200);
    expect(res.body.data[0].author.name).toBe("****");
    expect(res.body.meta).toEqual({ page: 2, pageSize: 5, total: 1, totalPages: 1 });
    expect(prismaMock.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 12, status: "PUBLISHED", deletedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 5,
        take: 5,
      }),
    );
  });

  it("supports rating filtering and rejects unknown sorting", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.count.mockResolvedValue(0);
    prismaMock.review.findMany.mockResolvedValue([]);

    expect(
      (await request(buildApp()).get("/api/v1/products/12/reviews?rating=5&sort=highest")).status,
    ).toBe(200);
    expect(prismaMock.review.findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: { productId: 12, status: "PUBLISHED", deletedAt: null, rating: 5 },
        orderBy: [{ rating: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect((await request(buildApp()).get("/api/v1/products/12/reviews?sort=random")).status).toBe(
      400,
    );
  });

  it("returns 404 for an inactive product", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: false });

    const res = await request(buildApp()).get("/api/v1/products/12/reviews");

    expect(res.status).toBe(404);
    expect(prismaMock.review.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/products/:id/reviews/summary", () => {
  it("calculates public distribution and average", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.groupBy.mockResolvedValue([
      { rating: 5, _count: { _all: 2 } },
      { rating: 4, _count: { _all: 1 } },
    ]);

    const res = await request(buildApp()).get("/api/v1/products/12/reviews/summary");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      productId: 12,
      averageRating: 4.7,
      totalReviews: 3,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 2 },
    });
    expect(prismaMock.review.groupBy).toHaveBeenCalledWith({
      by: ["rating"],
      where: { productId: 12, status: "PUBLISHED", deletedAt: null },
      _count: { _all: true },
    });
  });

  it("returns null average for a product with no public reviews", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.groupBy.mockResolvedValue([]);

    const res = await request(buildApp()).get("/api/v1/products/12/reviews/summary");

    expect(res.status).toBe(200);
    expect(res.body.data.averageRating).toBeNull();
    expect(res.body.data.totalReviews).toBe(0);
  });
});

describe("review eligibility and creation", () => {
  it("requires authentication", async () => {
    const res = await request(buildApp()).get("/api/v1/products/12/reviews/eligibility");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns ALREADY_REVIEWED before checking a new purchase", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12 });
    prismaMock.review.findUnique.mockResolvedValue(ownerReviewRow);

    const res = await request(buildApp())
      .get("/api/v1/products/12/reviews/eligibility")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ eligible: false, reason: "ALREADY_REVIEWED" });
    expect(res.body.data.existingReview.id).toBe(18);
    expect(prismaMock.orderDetail.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_PURCHASED", []],
    [
      "PAYMENT_NOT_CONFIRMED",
      [{ id: 1, order: { status: "COMPLETED", paymentStatus: "PAYMENT_UNPAID" } }],
    ],
    [
      "ORDER_NOT_COMPLETED",
      [{ id: 1, order: { status: "SHIPPING", paymentStatus: "PAYMENT_UNPAID" } }],
    ],
  ] as const)("returns %s for an ineligible purchase state", async (reason, items) => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12 });
    prismaMock.review.findUnique.mockResolvedValue(null);
    prismaMock.orderDetail.findMany.mockResolvedValue(items);

    const res = await request(buildApp())
      .get("/api/v1/products/12/reviews/eligibility")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ eligible: false, reason });
  });

  it("allows a qualifying purchase even when the product is inactive", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: false });
    prismaMock.review.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ fullName: "Nguyễn Văn A" });
    prismaMock.orderDetail.findFirst.mockResolvedValue({ id: 91 });
    prismaMock.review.create.mockResolvedValue(ownerReviewRow);

    const res = await request(buildApp())
      .post("/api/v1/products/12/reviews")
      .set("Cookie", cookieFor(USER))
      .send({ rating: 5, content: "Nội dung đủ dài", isAnonymous: true });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(18);
  });

  it("requires fullName for a public-name review", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12, isActive: true });
    prismaMock.review.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({ fullName: null });
    prismaMock.orderDetail.findFirst.mockResolvedValue({ id: 91 });

    const res = await request(buildApp())
      .post("/api/v1/products/12/reviews")
      .set("Cookie", cookieFor(USER))
      .send({ rating: 5, content: "Nội dung đủ dài", isAnonymous: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_FULL_NAME_REQUIRED");
  });

  it("returns 400 when the create body contains client-owned fields", async () => {
    const res = await request(buildApp())
      .post("/api/v1/products/12/reviews")
      .set("Cookie", cookieFor(USER))
      .send({
        rating: 5,
        content: "Nội dung đủ dài",
        isAnonymous: true,
        userId: 7,
        orderDetailId: 9,
        status: "PUBLISHED",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("customer review lifecycle", () => {
  it("lets the owner edit a review and keeps hidden status", async () => {
    prismaMock.review.findFirst.mockResolvedValue(hiddenOwnerReviewRow);
    prismaMock.review.update.mockResolvedValue({
      ...hiddenOwnerReviewRow,
      content: "Nội dung mới đủ dài hơn.",
      contentUpdatedAt: new Date("2026-10-21T05:00:00.000Z"),
    });

    const res = await request(buildApp())
      .patch("/api/v1/reviews/18")
      .set("Cookie", cookieFor(USER))
      .send({ content: "Nội dung mới đủ dài hơn." });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("HIDDEN");
    expect(prismaMock.review.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 18, userId: USER.id },
        data: expect.objectContaining({ content: "Nội dung mới đủ dài hơn." }),
      }),
    );
  });

  it("requires fullName when an owner changes to public name", async () => {
    prismaMock.review.findFirst.mockResolvedValue(ownerReviewRow);
    prismaMock.user.findUnique.mockResolvedValue({ fullName: null });

    const res = await request(buildApp())
      .patch("/api/v1/reviews/18")
      .set("Cookie", cookieFor(USER))
      .send({ isAnonymous: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_FULL_NAME_REQUIRED");
  });

  it("allows editing a review for an inactive product", async () => {
    prismaMock.review.findFirst.mockResolvedValue(ownerReviewRow);
    prismaMock.review.update.mockResolvedValue(ownerReviewRow);

    const res = await request(buildApp())
      .patch("/api/v1/reviews/18")
      .set("Cookie", cookieFor(USER))
      .send({ rating: 4 });

    expect(res.status).toBe(200);
  });

  it("returns not found for another owner or a missing review", async () => {
    prismaMock.review.findFirst.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch("/api/v1/reviews/18")
      .set("Cookie", cookieFor({ id: 2, role: "USER" }))
      .send({ rating: 4 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REVIEW_NOT_FOUND");
  });

  it("rejects editing a soft-deleted review", async () => {
    prismaMock.review.findFirst.mockResolvedValue(deletedOwnerReviewRow);

    const res = await request(buildApp())
      .patch("/api/v1/reviews/18")
      .set("Cookie", cookieFor(USER))
      .send({ rating: 4 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REVIEW_DELETED");
  });

  it("soft-deletes a review and makes repeated DELETE idempotent", async () => {
    prismaMock.review.findFirst
      .mockResolvedValueOnce(ownerReviewRow)
      .mockResolvedValueOnce(deletedOwnerReviewRow);

    const first = await request(buildApp())
      .delete("/api/v1/reviews/18")
      .set("Cookie", cookieFor(USER));
    const second = await request(buildApp())
      .delete("/api/v1/reviews/18")
      .set("Cookie", cookieFor(USER));

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(prismaMock.review.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 18, userId: USER.id },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it("allows rewriting a deleted public review", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12 });
    prismaMock.review.findUnique
      .mockResolvedValueOnce(deletedOwnerReviewRow)
      .mockResolvedValueOnce({ ...ownerReviewRow, deletedAt: null });
    prismaMock.orderDetail.findFirst.mockResolvedValue({ id: 91 });
    prismaMock.review.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(buildApp())
      .post("/api/v1/products/12/reviews")
      .set("Cookie", cookieFor(USER))
      .send({ rating: 5, content: "Nội dung viết lại đủ dài.", isAnonymous: true });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PUBLISHED");
    expect(prismaMock.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 18, userId: USER.id, deletedAt: { not: null } } }),
    );
  });

  it("keeps a previously hidden review hidden when it is rewritten", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ id: 12 });
    prismaMock.review.findUnique
      .mockResolvedValueOnce({
        ...hiddenOwnerReviewRow,
        deletedAt: new Date("2026-10-20T03:00:00.000Z"),
      })
      .mockResolvedValueOnce({ ...hiddenOwnerReviewRow, deletedAt: null });
    prismaMock.orderDetail.findFirst.mockResolvedValue({ id: 91 });
    prismaMock.review.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(buildApp())
      .post("/api/v1/products/12/reviews")
      .set("Cookie", cookieFor(USER))
      .send({ rating: 5, content: "Nội dung ẩn viết lại đủ dài.", isAnonymous: true });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("HIDDEN");
  });
});
