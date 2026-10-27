import type { AutomaticPromotionInput } from "modules/promotions/promotions.types";

export const automaticDiscountPerUnit = (
  promotion: Pick<AutomaticPromotionInput, "discountKind" | "discountValue">,
  listPrice: number,
) =>
  promotion.discountKind === "PERCENT"
    ? Math.min(listPrice, Math.floor((listPrice * promotion.discountValue) / 100))
    : Math.min(listPrice, promotion.discountValue);
