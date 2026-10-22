import type {
  AutomaticPromotionInput,
  CouponInput,
  PromotionPricingInput,
  PromotionPricingLineResult,
  PromotionPricingResult,
  PromotionPricingCandidate,
} from "modules/promotions/promotions.types";

export const automaticDiscountPerUnit = (promotion: AutomaticPromotionInput, listPrice: number) =>
  promotion.discountKind === "PERCENT"
    ? Math.min(listPrice, Math.floor((listPrice * promotion.discountValue) / 100))
    : Math.min(listPrice, promotion.discountValue);

export const selectAutomaticPromotion = (
  candidates: PromotionPricingCandidate[],
  listPrice: number,
): PromotionPricingCandidate | null =>
  [...candidates]
    .sort((a, b) => {
      const priority = b.priority - a.priority;
      if (priority !== 0) return priority;
      const discount =
        automaticDiscountPerUnit(b, listPrice) - automaticDiscountPerUnit(a, listPrice);
      return discount !== 0 ? discount : a.id - b.id;
    })
    .at(0) ?? null;

const couponAppliesToLine = (coupon: CouponInput, line: PromotionPricingLineResult) =>
  line.postProductLineTotal > 0 &&
  line.couponEligible &&
  (coupon.scope === "ORDER" || coupon.targetProductIds.includes(line.productId));

const allocateCoupon = (lines: PromotionPricingLineResult[], discountAmount: number) => {
  const eligible = lines.filter((line) => line.couponEligible && line.postProductLineTotal > 0);
  const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.postProductLineTotal, 0);
  if (discountAmount <= 0 || eligibleSubtotal <= 0) return;

  const allocations = eligible.map((line) => {
    const numerator = discountAmount * line.postProductLineTotal;
    return {
      line,
      base: Math.floor(numerator / eligibleSubtotal),
      remainder: numerator % eligibleSubtotal,
    };
  });
  let remaining = discountAmount - allocations.reduce((sum, item) => sum + item.base, 0);
  allocations
    .sort((a, b) => b.remainder - a.remainder || a.line.productId - b.line.productId)
    .forEach((item) => {
      if (remaining > 0) {
        item.base += 1;
        remaining -= 1;
      }
      item.line.couponDiscountAmount = item.base;
      item.line.netLineTotal = item.line.postProductLineTotal - item.base;
    });
};

export const calculatePromotionPricing = (input: PromotionPricingInput): PromotionPricingResult => {
  const coupon = input.coupon ?? null;
  const lines = [...input.lines]
    .sort((a, b) => a.productId - b.productId)
    .map((line): PromotionPricingLineResult => {
      const automaticPromotion = selectAutomaticPromotion(
        line.automaticCandidates ?? [],
        line.listPrice,
      );
      const lineSubtotal = line.listPrice * line.quantity;
      const productDiscountAmount = automaticPromotion
        ? automaticDiscountPerUnit(automaticPromotion, line.listPrice) * line.quantity
        : 0;
      const postProductLineTotal = lineSubtotal - productDiscountAmount;
      const couponEligible =
        Boolean(coupon) &&
        (!automaticPromotion || automaticPromotion.stackableWithCoupon) &&
        (!coupon || coupon.scope === "ORDER" || coupon.targetProductIds.includes(line.productId));
      return {
        productId: line.productId,
        quantity: line.quantity,
        listPrice: line.listPrice,
        lineSubtotal,
        automaticPromotion,
        promotionKind: automaticPromotion?.kind ?? (automaticPromotion ? "AUTOMATIC" : null),
        flashSale:
          automaticPromotion?.kind === "FLASH_SALE"
            ? {
                remainingQuota: automaticPromotion.showRemainingQuota
                  ? (automaticPromotion.remainingQuota ?? null)
                  : null,
                maxUnitsPerUser: automaticPromotion.maxUnitsPerUser ?? 0,
                ...(automaticPromotion.userRemainingQuota === undefined
                  ? {}
                  : { userRemainingQuota: automaticPromotion.userRemainingQuota }),
              }
            : null,
        productDiscountAmount,
        postProductLineTotal,
        couponEligible,
        couponDiscountAmount: 0,
        netLineTotal: postProductLineTotal,
      };
    });

  const subtotalPrice = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const productDiscountAmount = lines.reduce((sum, line) => sum + line.productDiscountAmount, 0);
  const couponEligibleSubtotal = coupon
    ? lines
        .filter((line) => couponAppliesToLine(coupon, line))
        .reduce((sum, line) => sum + line.postProductLineTotal, 0)
    : 0;
  const postProductSubtotal = subtotalPrice - productDiscountAmount;
  const minimumMet = coupon
    ? (coupon.scope === "ORDER" ? postProductSubtotal : couponEligibleSubtotal) >=
      coupon.minOrderValue
    : false;
  const uncappedCouponDiscount =
    coupon && minimumMet
      ? coupon.discountKind === "PERCENT"
        ? Math.floor((couponEligibleSubtotal * coupon.discountValue) / 100)
        : coupon.discountValue
      : 0;
  const couponDiscountAmount = Math.min(
    couponEligibleSubtotal,
    coupon?.maxDiscount == null
      ? uncappedCouponDiscount
      : Math.min(uncappedCouponDiscount, coupon.maxDiscount),
  );

  allocateCoupon(lines, couponDiscountAmount);
  const totalPrice = lines.reduce((sum, line) => sum + line.netLineTotal, 0);
  return {
    subtotalPrice,
    productDiscountAmount,
    couponEligibleSubtotal,
    couponDiscountAmount,
    totalPrice,
    coupon,
    lines,
  };
};
