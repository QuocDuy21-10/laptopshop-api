import { prisma } from "config/client";
import type { DemoDataset } from "scripts/demo-seed/types";

export const persistDemoDataset = async (data: DemoDataset) => {
  // initDatabase's OPENING rows carry today's date; the simulated ledger replaces them
  await prisma.stockMovement.deleteMany();
  await prisma.product.createMany({ data: data.products });
  for (const update of data.productUpdates)
    await prisma.product.update({
      where: { id: update.id },
      data: { quantity: update.quantity, sold: update.sold },
    });
  await prisma.stockReceipt.createMany({ data: data.stockReceipts });
  await prisma.stockReceiptItem.createMany({ data: data.stockReceiptItems });
  await prisma.homeBanner.createMany({ data: data.homeBanners });
  await prisma.user.createMany({ data: data.users });
  await prisma.cart.createMany({ data: data.carts });
  await prisma.cartDetail.createMany({ data: data.cartDetails });
  await prisma.wishlistItem.createMany({ data: data.wishlistItems });
  await prisma.newsletterSubscriber.createMany({ data: data.newsletterSubscribers });
  await prisma.promotion.createMany({ data: data.promotions });
  await prisma.couponPolicy.createMany({ data: data.couponPolicies });
  await prisma.automaticPromotionPolicy.createMany({ data: data.automaticPromotionPolicies });
  await prisma.flashSalePolicy.createMany({ data: data.flashSalePolicies });
  await prisma.promotionProduct.createMany({ data: data.promotionProducts });
  await prisma.flashSaleProductQuota.createMany({ data: data.flashSaleProductQuotas });
  await prisma.order.createMany({ data: data.orders });
  await prisma.orderDetail.createMany({ data: data.orderDetails });
  await prisma.orderStatusHistory.createMany({ data: data.orderStatusHistory });
  await prisma.payment.createMany({ data: data.payments });
  await prisma.promotionRedemption.createMany({ data: data.promotionRedemptions });
  await prisma.promotionUserUsage.createMany({ data: data.promotionUserUsages });
  await prisma.flashSaleAllocation.createMany({ data: data.flashSaleAllocations });
  await prisma.flashSaleUserUsage.createMany({ data: data.flashSaleUserUsages });
  await prisma.stockMovement.createMany({ data: data.stockMovements });
  await prisma.review.createMany({ data: data.reviews });
  await prisma.reviewReply.createMany({ data: data.reviewReplies });
  await prisma.reviewHelpful.createMany({ data: data.reviewHelpful });
  await prisma.serviceRequest.createMany({ data: data.serviceRequests });
  await prisma.serviceRequestItem.createMany({ data: data.serviceRequestItems });
  await prisma.warrantyVerification.createMany({ data: data.warrantyVerifications });
  await prisma.serviceRequestEvent.createMany({ data: data.serviceRequestEvents });
  await prisma.serviceQuote.createMany({ data: data.serviceQuotes });
  await prisma.serviceQuoteLine.createMany({ data: data.serviceQuoteLines });
};
