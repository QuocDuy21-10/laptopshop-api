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

export type PricingLineInput = {
  productId: number;
  quantity: number;
  listPrice: number;
  automaticCandidates?: AutomaticPromotionInput[];
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
  automaticPromotion: AutomaticPromotionInput | null;
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
