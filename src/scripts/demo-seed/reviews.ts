import type { Prisma } from "@prisma/client";

import {
  HIDDEN_REASONS,
  REVIEW_REPLIES,
  REVIEW_TEXTS,
  type ReviewBucket,
} from "scripts/demo-seed/data";
import type { DemoUser, WithId } from "scripts/demo-seed/types";
import type { PlacedOrder } from "scripts/demo-seed/orders";
import { DAY, HOUR, MINUTE, earlier, shift, type Rng } from "scripts/demo-seed/random";

export const REVIEW_TARGET = 130;

type ReviewRow = WithId<Prisma.ReviewCreateManyInput> & { createdAt: Date };

const bucketOf = (rating: number): ReviewBucket =>
  rating >= 4 ? "good" : rating === 3 ? "mid" : "bad";

export const buildReviews = (
  rng: Rng,
  input: { now: Date; placed: PlacedOrder[]; users: DemoUser[]; adminId: number },
) => {
  const latest = shift(input.now, -30 * MINUTE);
  const candidates = rng.shuffle(
    input.placed.flatMap(({ status, completedAt, userId, lines }) =>
      status === "COMPLETED" && completedAt
        ? lines.map((line) => ({ userId, completedAt, line }))
        : [],
    ),
  );
  const reviews: ReviewRow[] = [];
  const reviewed = new Set<string>();
  for (const { userId, completedAt, line } of candidates) {
    if (reviews.length >= REVIEW_TARGET) break;
    const key = `${userId}:${line.productId}`;
    const createdAt = shift(completedAt, rng.int(1, 10) * DAY + rng.int(0, 12) * HOUR);
    if (reviewed.has(key) || createdAt > shift(latest, -HOUR)) continue;
    reviewed.add(key);
    const rating = rng.weighted([
      [5, 45],
      [4, 35],
      [3, 10],
      [2, 5],
      [1, 5],
    ] as const);
    const text = rng.pick(REVIEW_TEXTS[bucketOf(rating)]);
    reviews.push({
      id: reviews.length + 1,
      userId,
      productId: line.productId,
      orderDetailId: line.detailId,
      rating,
      title: text.title,
      content: text.content,
      isAnonymous: rng.chance(0.15),
      status: "PUBLISHED",
      createdAt,
      contentUpdatedAt: createdAt,
      updatedAt: createdAt,
    });
  }

  for (const review of rng.shuffle(reviews).slice(0, 5)) {
    const moderatedAt = earlier(shift(review.createdAt, DAY), latest);
    Object.assign(review, {
      status: "HIDDEN",
      hiddenReason: rng.pick(HIDDEN_REASONS),
      moderatedAt,
      moderatedById: input.adminId,
      updatedAt: moderatedAt,
    });
  }

  const published = reviews.filter((review) => review.status === "PUBLISHED");
  const reviewReplies: Prisma.ReviewReplyCreateManyInput[] = published
    .filter(() => rng.chance(0.3))
    .map((review) => {
      const createdAt = earlier(shift(review.createdAt, rng.int(2, 48) * HOUR), latest);
      return {
        reviewId: review.id,
        content: rng.pick(REVIEW_REPLIES[bucketOf(review.rating)]),
        createdById: input.adminId,
        updatedById: input.adminId,
        createdAt,
        updatedAt: createdAt,
      };
    });
  const reviewHelpful: Prisma.ReviewHelpfulCreateManyInput[] = published.flatMap((review) => {
    const voters = rng.shuffle(input.users.filter((user) => user.id !== review.userId)).slice(
      0,
      rng.weighted([
        [0, 40],
        [1, 25],
        [2, 15],
        [3, 10],
        [5, 10],
      ] as const),
    );
    return voters.map((user) => ({
      reviewId: review.id,
      userId: user.id,
      createdAt: rng.dateBetween(review.createdAt, latest),
    }));
  });

  return { reviews, reviewReplies, reviewHelpful };
};
