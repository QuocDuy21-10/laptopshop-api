import { ADMIN_ID, NOW, buildOrderFixture, time } from "./fixtures";
import { buildReviews } from "scripts/demo-seed/reviews";

const { rng, customers, orders } = buildOrderFixture(5);
const result = buildReviews(rng, {
  now: NOW,
  placed: orders.placed,
  users: customers.users,
  adminId: ADMIN_ID,
});
const lineOf = new Map(
  orders.placed.flatMap((order) =>
    order.lines.map((line) => [line.detailId, { order, line }] as const),
  ),
);

describe("buildReviews", () => {
  it("writes about 130 verified-purchase reviews", () => {
    expect(result.reviews.length).toBeGreaterThanOrEqual(120);
    expect(result.reviews.length).toBeLessThanOrEqual(130);
    const keys = new Set<string>();
    for (const review of result.reviews) {
      const source = lineOf.get(review.orderDetailId);
      expect(source?.order.status).toBe("COMPLETED");
      expect(review.userId).toBe(source?.order.userId);
      expect(review.productId).toBe(source?.line.productId);
      expect(time(review.createdAt)).toBeGreaterThan(time(source?.order.completedAt));
      expect(time(review.createdAt)).toBeLessThan(NOW.getTime());
      keys.add(`${review.userId}:${review.productId}`);
    }
    expect(keys.size).toBe(result.reviews.length);
  });

  it("hides five reviews with a moderator and reason", () => {
    const hidden = result.reviews.filter((r) => r.status === "HIDDEN");
    expect(hidden).toHaveLength(5);
    hidden.forEach((r) =>
      expect(r).toMatchObject({ moderatedById: ADMIN_ID, hiddenReason: expect.any(String) }),
    );
  });

  it("replies and votes only on published reviews, never by the author", () => {
    const published = new Map(
      result.reviews.filter((r) => r.status === "PUBLISHED").map((r) => [r.id, r]),
    );
    expect(result.reviewReplies.length).toBeGreaterThan(0);
    result.reviewReplies.forEach((reply) => expect(published.has(reply.reviewId)).toBe(true));
    result.reviewHelpful.forEach((vote) => {
      expect(published.get(vote.reviewId)?.userId).not.toBe(vote.userId);
    });
  });
});
