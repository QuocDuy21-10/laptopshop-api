import {
  createReviewBody,
  listProductReviewsQuery,
  helpfulReviewIdsQuery,
  putReviewReplyBody,
} from "modules/reviews/reviews.schema";

describe("review schemas", () => {
  it("coerces list filters and applies defaults", () => {
    expect(listProductReviewsQuery.parse({ rating: "5", sort: "highest" })).toMatchObject({
      page: 1,
      pageSize: 10,
      rating: 5,
      sort: "highest",
    });
  });

  it("rejects unsupported review sorting and rating values", () => {
    expect(() => listProductReviewsQuery.parse({ sort: "random" })).toThrow();
    expect(() => listProductReviewsQuery.parse({ rating: "6" })).toThrow();
  });

  it("requires an explicit anonymity choice and validates review content", () => {
    expect(() => createReviewBody.parse({ rating: 5, content: "Nội dung đủ dài" })).toThrow();
    expect(
      createReviewBody.parse({
        rating: 5,
        content: "Nội dung đủ dài",
        isAnonymous: true,
      }),
    ).toMatchObject({ isAnonymous: true });
  });

  it("rejects client-owned identity and moderation fields", () => {
    expect(() =>
      createReviewBody.parse({
        rating: 5,
        content: "Nội dung đủ dài",
        isAnonymous: true,
        userId: 7,
        orderDetailId: 9,
        status: "PUBLISHED",
      }),
    ).toThrow();
  });

  it("normalizes helpful IDs and caps the batch at 50 unique positive values", () => {
    expect(helpfulReviewIdsQuery.parse({ reviewIds: "2,2,5" })).toEqual({ reviewIds: [2, 5] });
    expect(() => helpfulReviewIdsQuery.parse({ reviewIds: "0,1" })).toThrow();
    expect(() =>
      helpfulReviewIdsQuery.parse({
        reviewIds: Array.from({ length: 51 }, (_, i) => i + 1).join(","),
      }),
    ).toThrow();
  });

  it("strictly trims and bounds official reply content", () => {
    expect(putReviewReplyBody.parse({ content: "  Phản hồi chính thức  " })).toEqual({
      content: "Phản hồi chính thức",
    });
    expect(() => putReviewReplyBody.parse({ content: "" })).toThrow();
    expect(() => putReviewReplyBody.parse({ content: "x", extra: true })).toThrow();
    expect(() => putReviewReplyBody.parse({ content: "x".repeat(1001) })).toThrow();
  });
});
