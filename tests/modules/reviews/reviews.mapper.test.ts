import { toPublicReviewDto } from "modules/reviews/reviews.mapper";

const baseRow = {
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

describe("toPublicReviewDto", () => {
  it("masks an anonymous author and omits internal fields", () => {
    const dto = toPublicReviewDto(baseRow);

    expect(dto.author).toEqual({ name: "****", anonymous: true });
    expect(dto.verifiedPurchase).toBe(true);
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("orderDetailId");
    expect(dto.updatedAt).toEqual(baseRow.contentUpdatedAt);
  });

  it("uses the full name for public reviews and a safe fallback for legacy rows", () => {
    expect(toPublicReviewDto({ ...baseRow, isAnonymous: false }).author).toEqual({
      name: "Nguyễn Văn A",
      anonymous: false,
    });
    expect(
      toPublicReviewDto({ ...baseRow, isAnonymous: false, user: { fullName: null } }).author,
    ).toEqual({
      name: "Khách hàng LaptopShop",
      anonymous: false,
    });
  });
});
