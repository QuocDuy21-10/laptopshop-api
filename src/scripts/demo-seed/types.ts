import type { Prisma } from "@prisma/client";

export type WithId<T> = T & { id: number };

export type BaseProduct = {
  id: number;
  name: string;
  price: number;
  quantity: number;
  factory: string | null;
  target: string | null;
  warrantyMonths: number | null;
  isActive: boolean;
};

export type StockEndState = "NORMAL" | "OUT_OF_STOCK" | "LOW_STOCK";

export type DemoProduct = {
  id: number;
  name: string;
  price: number;
  factory: string;
  target: string;
  warrantyMonths: number;
  isActive: boolean;
  openingQuantity: number;
  endState: StockEndState;
};

export type DemoUser = {
  id: number;
  username: string;
  fullName: string;
  phone: string;
  address: string;
};

export type DemoDataset = {
  products: WithId<Prisma.ProductCreateManyInput>[];
  productUpdates: { id: number; quantity: number; sold: number }[];
  stockReceipts: Prisma.StockReceiptCreateManyInput[];
  stockReceiptItems: Prisma.StockReceiptItemCreateManyInput[];
  homeBanners: Prisma.HomeBannerCreateManyInput[];
  bannerImages: { from: string; to: string }[];
  users: WithId<Prisma.UserCreateManyInput>[];
  carts: Prisma.CartCreateManyInput[];
  cartDetails: Prisma.CartDetailCreateManyInput[];
  wishlistItems: Prisma.WishlistItemCreateManyInput[];
  newsletterSubscribers: Prisma.NewsletterSubscriberCreateManyInput[];
  promotions: WithId<Prisma.PromotionCreateManyInput>[];
  couponPolicies: Prisma.CouponPolicyCreateManyInput[];
  automaticPromotionPolicies: Prisma.AutomaticPromotionPolicyCreateManyInput[];
  flashSalePolicies: Prisma.FlashSalePolicyCreateManyInput[];
  promotionProducts: Prisma.PromotionProductCreateManyInput[];
  flashSaleProductQuotas: Prisma.FlashSaleProductQuotaCreateManyInput[];
  orders: WithId<Prisma.OrderCreateManyInput>[];
  orderDetails: WithId<Prisma.OrderDetailCreateManyInput>[];
  orderStatusHistory: Prisma.OrderStatusHistoryCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
  promotionRedemptions: Prisma.PromotionRedemptionCreateManyInput[];
  promotionUserUsages: Prisma.PromotionUserUsageCreateManyInput[];
  flashSaleAllocations: Prisma.FlashSaleAllocationCreateManyInput[];
  flashSaleUserUsages: Prisma.FlashSaleUserUsageCreateManyInput[];
  stockMovements: Prisma.StockMovementCreateManyInput[];
  reviews: WithId<Prisma.ReviewCreateManyInput>[];
  reviewReplies: Prisma.ReviewReplyCreateManyInput[];
  reviewHelpful: Prisma.ReviewHelpfulCreateManyInput[];
  serviceRequests: WithId<Prisma.ServiceRequestCreateManyInput>[];
  serviceRequestItems: WithId<Prisma.ServiceRequestItemCreateManyInput>[];
  warrantyVerifications: Prisma.WarrantyVerificationCreateManyInput[];
  serviceRequestEvents: Prisma.ServiceRequestEventCreateManyInput[];
  serviceQuotes: WithId<Prisma.ServiceQuoteCreateManyInput>[];
  serviceQuoteLines: Prisma.ServiceQuoteLineCreateManyInput[];
};
