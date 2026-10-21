import { createReviewBody, listProductReviewsQuery } from "modules/reviews/reviews.schema";

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
});
