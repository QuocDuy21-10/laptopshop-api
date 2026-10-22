export type DiscountKind = "PERCENT" | "FIXED";
export type CouponScope = "ORDER" | "PRODUCT";

export type AutomaticPromotionInput = {
  id: number;
  name: string;
  discountKind: DiscountKind;
  discountValue: number;
  priority: number;
  stackableWithCoupon: boolean;
  pricingVersion: number;
};

export type PromotionCandidateKind = "AUTOMATIC" | "FLASH_SALE";

export type PromotionPricingCandidate = AutomaticPromotionInput & {
  kind?: PromotionCandidateKind;
  totalQuota?: number;
  claimedUnits?: number;
  remainingQuota?: number;
  maxUnitsPerUser?: number;
  showRemainingQuota?: boolean;
  userClaimedUnits?: number;
  userRemainingQuota?: number;
};

export type CouponInput = {
  id: number;
  code: string;
  name: string;
  scope: CouponScope;
  discountKind: DiscountKind;
  discountValue: number;
  minOrderValue: number;
  maxDiscount: number | null;
  pricingVersion: number;
  targetProductIds: number[];
};

export type ResolvedCoupon = CouponInput & { promotionName: string };

export type PricingQuoteDto = {
  subtotal: number;
  productDiscount: number;
  couponEligibleSubtotal: number;
  couponDiscount: number;
  total: number;
  lines: Array<PromotionPricingLineResult>;
  coupon: { id: number; code: string; name: string; valid: true } | null;
  calculatedAt: Date;
  pricingFingerprint: string;
};

export type PricingLineInput = {
  productId: number;
  quantity: number;
  listPrice: number;
  automaticCandidates?: PromotionPricingCandidate[];
};

export type PromotionPricingInput = {
  lines: PricingLineInput[];
  coupon?: CouponInput | null;
};

export type PromotionPricingLineResult = {
  productId: number;
  quantity: number;
  listPrice: number;
  lineSubtotal: number;
  automaticPromotion: PromotionPricingCandidate | null;
  promotionKind: PromotionCandidateKind | null;
  flashSale: {
    remainingQuota: number | null;
    maxUnitsPerUser: number;
    userRemainingQuota?: number;
    startsAt?: Date;
    endsAt?: Date;
  } | null;
  productDiscountAmount: number;
  postProductLineTotal: number;
  couponEligible: boolean;
  couponDiscountAmount: number;
  netLineTotal: number;
};

export type PromotionPricingResult = {
  subtotalPrice: number;
  productDiscountAmount: number;
  couponEligibleSubtotal: number;
  couponDiscountAmount: number;
  totalPrice: number;
  coupon: CouponInput | null;
  lines: PromotionPricingLineResult[];
};

export type PricingFingerprintLineInput = {
  productId: number;
  quantity: number;
  listPrice: number;
  automaticPromotionId: number | null;
  pricingVersion: number | null;
  promotionId?: number | null;
  promotionKind?: PromotionCandidateKind | null;
  discountKind?: DiscountKind | null;
  discountValue?: number | null;
  priority?: number | null;
  stackableWithCoupon?: boolean | null;
  maxUnitsPerUser?: number | null;
  totalQuota?: number | null;
  claimedUnits?: number | null;
  remainingQuota?: number | null;
  showRemainingQuota?: boolean | null;
};

export type PricingFingerprintInput = {
  lines: PricingFingerprintLineInput[];
  coupon: {
    id: number;
    pricingVersion: number;
    scope: CouponScope;
    targetProductIds: number[];
  } | null;
  totals: Pick<
    PromotionPricingResult,
    | "subtotalPrice"
    | "productDiscountAmount"
    | "couponEligibleSubtotal"
    | "couponDiscountAmount"
    | "totalPrice"
  >;
};

export type CheckoutRequestHashInput = {
  receiverName: string;
  receiverAddress: string;
  receiverPhone: string;
  paymentMethod: string;
  couponCode?: string | null;
  pricingFingerprint: string;
};
