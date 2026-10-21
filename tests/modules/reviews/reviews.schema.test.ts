import { listProductReviewsQuery } from "modules/reviews/reviews.schema";

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
});
