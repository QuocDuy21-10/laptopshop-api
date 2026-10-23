import { Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import { env } from "config/env";
import { idParams, pageQuery } from "lib/http";
import { loginBody, registerBody } from "modules/auth/auth.schema";
import {
  adminCreateUserBody,
  adminListUsersQuery,
  adminUpdateUserBody,
  updateMeBody,
} from "modules/users/users.schema";
import {
  adminExportProductsQuery,
  adminListProductsQuery,
  compareQuery,
  listProductsQuery,
  productFacetsQuery,
  productBody,
  productPatchBody,
} from "modules/products/products.schema";
import { addItemBody, updateItemBody } from "modules/cart/cart.schema";
import {
  adminExportOrdersQuery,
  adminListOrdersQuery,
  placeOrderBody,
  quoteOrderBody,
  updateStatusBody,
} from "modules/orders/orders.schema";
import { salesQuery } from "modules/dashboard/dashboard.schema";
import {
  adjustmentBody,
  exportMovementsQuery,
  listMovementsQuery,
} from "modules/inventory/inventory.schema";
import {
  createReceiptBody,
  listReceiptsQuery,
  receiptIdParams,
  updateReceiptBody,
} from "modules/inventory/inventory-receipts.schema";
import { ORDER_STATUSES } from "modules/orders/order-status";
import {
  paymentEventQuery,
  paymentProviderParam,
  resolvePaymentEventBody,
} from "modules/payments/payments.schema";
import {
  adminListReviewsQuery,
  createReviewBody,
  listProductReviewsQuery,
  moderateReviewBody,
  reviewImageDeleteParams,
  reviewImageOrderBody,
  reviewImageParams,
  updateReviewBody,
  helpfulReviewIdsQuery,
  putReviewReplyBody,
} from "modules/reviews/reviews.schema";
import {
  adminPromotionQuery,
  createPromotionBody,
  promotionIdParams,
  promotionRedemptionQuery,
  transitionPromotionBody,
  updatePromotionBody,
  flashSaleAvailabilityQuery,
  flashSaleAllocationQuery,
} from "modules/promotions/promotions.schema";
import {
  configurePriceAlertBody,
  wishlistProductParams,
  wishlistQuery,
  wishlistStatusQuery,
} from "modules/wishlist/wishlist.schema";
import { notificationsQuery } from "modules/notifications/notifications.schema";
import { updateNotificationPreferencesBody } from "modules/notifications/notification-preferences.schema";
import { deviceEligibilityQuery } from "modules/after-sales/after-sales.schema";
import { webPushSubscriptionBody } from "modules/notifications/web-push.schema";
import { confirmEmailVerificationBody } from "modules/email-verification/email-verification.schema";
import {
  notificationDeliveryQuery,
  retryNotificationDeliveryBody,
} from "modules/notifications/admin-notifications.schema";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "access_token",
});
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
const secured = [{ cookieAuth: [] }, { bearerAuth: [] }];

const ErrorBody = registry.register(
  "Error",
  z.object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  }),
);
const Meta = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
const userShape = {
  id: z.number(),
  username: z.string(),
  fullName: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  accountType: z.string().nullable(),
  avatar: z.string().nullable(),
  emailVerifiedAt: z.string().datetime().nullable(),
  role: z.string(),
};
const User = registry.register("User", z.object(userShape));
const Me = registry.register("Me", z.object({ ...userShape, cartItemCount: z.number() }));
const productShape = {
  id: z.number(),
  name: z.string(),
  price: z.number(),
  image: z.string().nullable(),
  detailDesc: z.string().nullable(),
  shortDesc: z.string().nullable(),
  quantity: z.number(),
  sold: z.number().nullable(),
  factory: z.string().nullable(),
  target: z.string().nullable(),
  isActive: z.boolean(),
  cpu: z.string().nullable(),
  cpuBrand: z.string().nullable(),
  gpu: z.string().nullable(),
  gpuBrand: z.string().nullable(),
  gpuType: z.string().nullable(),
  ramGb: z.number().int().nullable(),
  storageGb: z.number().int().nullable(),
  screenSizeInch: z.number().nullable(),
  screenResolution: z.string().nullable(),
  resolutionTier: z.string().nullable(),
  panelType: z.string().nullable(),
  refreshRateHz: z.number().int().nullable(),
  batteryWh: z.number().int().nullable(),
  weightGrams: z.number().int().nullable(),
  warrantyMonths: z.number().int().nullable(),
};
const Product = registry.register("Product", z.object(productShape));
const PricedProduct = registry.register(
  "PricedProduct",
  z.object({
    ...productShape,
    salePrice: z.number().int(),
    productDiscountAmount: z.number().int(),
    promotion: z
      .object({ id: z.number(), name: z.string(), endsAt: z.string().datetime() })
      .nullable(),
  }),
);
const ProductReviewSummary = registry.register(
  "ProductReviewSummary",
  z.object({ averageRating: z.number().nullable(), totalReviews: z.number().int() }),
);
const CatalogProduct = registry.register(
  "CatalogProduct",
  z.object({ ...PricedProduct.shape, reviewSummary: ProductReviewSummary }),
);
const PriceAlertMode = registry.register(
  "PriceAlertMode",
  z.enum(["PERCENT_DROP", "TARGET_PRICE"]),
);
void PriceAlertMode;
const PriceSnapshot = registry.register(
  "PriceSnapshot",
  z.object({
    productId: z.number(),
    listPrice: z.number().int(),
    stablePrice: z.number().int(),
    effectivePrice: z.number().int(),
    source: z.enum(["LIST_PRICE", "AUTOMATIC", "FLASH_SALE"]),
    promotionId: z.number().nullable(),
    pricingVersion: z.number().nullable(),
    validUntil: z.string().datetime().nullable(),
    purchasable: z.boolean(),
  }),
);
const NullablePriceAlertMode = z.enum(["PERCENT_DROP", "TARGET_PRICE"]).nullable();
const WishlistItem = registry.register(
  "WishlistItem",
  z.object({
    id: z.number(),
    productId: z.number(),
    product: PricedProduct,
    alertMode: NullablePriceAlertMode,
    targetPrice: z.number().int().nullable(),
    referencePrice: z.number().int().nullable(),
    includeFlashSale: z.boolean(),
    alertVersion: z.number().int(),
    priceSnapshot: PriceSnapshot,
    lastAlertMode: NullablePriceAlertMode,
    lastAlertedPrice: z.number().int().nullable(),
    lastAlertedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);
const WishlistSummary = registry.register(
  "WishlistSummary",
  z.object({ itemCount: z.number().int() }),
);
const WishlistStatus = registry.register(
  "WishlistStatus",
  z.object({ productId: z.number().int(), isWishlisted: z.boolean() }),
);
const Notification = registry.register(
  "Notification",
  z.object({
    id: z.number(),
    productId: z.number().nullable(),
    type: z.enum(["PRICE_DROP"]),
    title: z.string(),
    message: z.string(),
    oldPrice: z.number().int().nullable(),
    newPrice: z.number().int().nullable(),
    priceSource: z.enum(["LIST_PRICE", "AUTOMATIC", "FLASH_SALE"]).nullable(),
    promotionId: z.number().nullable(),
    pricingVersion: z.number().nullable(),
    validUntil: z.string().datetime().nullable(),
    readAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
);
const AdvisorRequest = registry.register(
  "AdvisorRequest",
  z
    .object({
      budgetMax: z.number().int().min(5_000_000).max(200_000_000),
      usage: z.enum(["CODING", "GAMING", "OFFICE", "CREATIVE"]),
      priorities: z
        .array(z.enum(["PERFORMANCE", "PORTABILITY", "BATTERY", "DISPLAY", "VALUE"]))
        .max(3),
      minRamGb: z.union([z.literal(8), z.literal(16), z.literal(32)]).optional(),
      workloads: z
        .array(z.enum(["DOCKER_VM", "ESPORTS", "AAA_GAMING", "PHOTO_VIDEO", "CAD_3D"]))
        .max(5)
        .optional(),
      note: z.string().max(500).optional(),
    })
    .openapi("AdvisorRequest"),
);
const AdvisorRecommendation = registry.register(
  "AdvisorRecommendation",
  z.object({
    product: PricedProduct,
    matchScore: z.number().int().min(0).max(100),
    highlights: z.array(z.string()),
    reason: z.string(),
    tradeoffs: z.array(z.string()),
  }),
);
const AdvisorResult = registry.register(
  "AdvisorResult",
  z.object({
    mode: z.enum(["ai_enhanced", "rule_based"]),
    recommendations: z.array(AdvisorRecommendation),
    suggestions: z.array(z.string()),
  }),
);
const Option = z.object({ name: z.string(), value: z.string() });
const FacetDefinition = registry.register(
  "FacetDefinition",
  z.object({
    key: z.string(),
    name: z.string(),
    mode: z.enum(["MULTI", "SINGLE_MIN", "SINGLE_MAX", "BOOLEAN"]),
    kind: z.enum(["categorical", "exact", "bucket"]),
    options: z.array(Option).optional(),
  }),
);
const ProductFilterCatalog = registry.register(
  "ProductFilterCatalog",
  z.object({
    factoryOptions: z.array(Option),
    targetOptions: z.array(Option),
    facetDefinitions: z.array(FacetDefinition),
  }),
);
const ProductFacets = registry.register(
  "ProductFacets",
  z.object({
    total: z.number(),
    groups: z.record(z.string(), z.array(z.object({ value: z.string(), count: z.number() }))),
  }),
);
const Cart = registry.register(
  "Cart",
  z.object({
    items: z.array(
      z.object({
        id: z.number(),
        quantity: z.number(),
        listLineTotal: z.number(),
        productDiscountAmount: z.number(),
        lineTotal: z.number(),
        product: PricedProduct,
      }),
    ),
    itemCount: z.number(),
    subtotal: z.number(),
    productDiscount: z.number(),
    totalAfterProductDiscount: z.number(),
  }),
);
const PricingQuote = registry.register(
  "PricingQuote",
  z.object({
    subtotal: z.number(),
    productDiscount: z.number(),
    couponEligibleSubtotal: z.number(),
    couponDiscount: z.number(),
    total: z.number(),
    lines: z.array(z.record(z.unknown())),
    coupon: z
      .object({ id: z.number(), code: z.string(), name: z.string(), valid: z.literal(true) })
      .nullable(),
    calculatedAt: z.string().datetime(),
    pricingFingerprint: z.string(),
  }),
);
const PublicPromotion = registry.register(
  "PublicPromotion",
  z.object({
    id: z.number(),
    name: z.string(),
    description: z.string().nullable(),
    code: z.string(),
    scope: z.enum(["ORDER", "PRODUCT"]),
    discountKind: z.enum(["PERCENT", "FIXED"]),
    discountValue: z.number(),
    minOrderValue: z.number(),
    maxDiscount: z.number().nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
);
const FlashSaleAvailability = registry.register(
  "FlashSaleAvailability",
  z.object({
    productId: z.number(),
    promotionId: z.number(),
    name: z.string(),
    state: z.enum(["SCHEDULED", "RUNNING"]),
    available: z.boolean(),
    remainingQuota: z.number().nullable(),
    maxUnitsPerUser: z.number(),
    userRemainingQuota: z.number().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
);
const orderShape = {
  id: z.number(),
  status: z.enum(ORDER_STATUSES),
  totalPrice: z.number(),
  subtotalPrice: z.number(),
  productDiscountAmount: z.number(),
  couponEligibleSubtotal: z.number(),
  couponDiscountAmount: z.number(),
  couponCode: z.string().nullable(),
  couponName: z.string().nullable(),
  paymentRequired: z.boolean(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
  receiverName: z.string(),
  receiverAddress: z.string(),
  receiverPhone: z.string(),
  createdAt: z.string().datetime(),
  items: z.array(
    z.object({
      orderDetailId: z.number(),
      productId: z.number(),
      name: z.string(),
      image: z.string().nullable(),
      price: z.number(),
      quantity: z.number(),
      warrantyMonthsSnapshot: z.number().nullable(),
      warrantyStartAt: z.string().datetime().nullable(),
      warrantyEndAt: z.string().datetime().nullable(),
      warrantyPolicySource: z.enum([
        "CHECKOUT_SNAPSHOT",
        "CURRENT_PRODUCT_POLICY_BACKFILL",
        "UNAVAILABLE",
      ]),
      coverage: z.enum(["IN_WARRANTY", "OUT_OF_WARRANTY", "NO_WARRANTY", "REQUIRES_VERIFICATION"]),
      allowedRequestTypes: z.array(z.enum(["WARRANTY", "TECHNICAL_SUPPORT"])),
      productDiscountAmount: z.number(),
      couponDiscountAmount: z.number(),
      netLineTotal: z.number(),
      automaticPromotionId: z.number().nullable(),
      automaticPromotionName: z.string().nullable(),
      promotionKind: z.enum(["AUTOMATIC", "FLASH_SALE"]).nullable(),
      flashSaleAllocation: z
        .object({
          promotionId: z.number(),
          quantity: z.number(),
          discountAmount: z.number(),
          status: z.enum(["CLAIMED", "RELEASED"]),
        })
        .nullable(),
    }),
  ),
};
const Order = registry.register("Order", z.object(orderShape));
const EligibleDevice = registry.register(
  "EligibleAfterSalesDevice",
  z.object({
    orderDetailId: z.number(),
    orderId: z.number(),
    product: z.object({ id: z.number(), name: z.string(), image: z.string().nullable() }),
    quantity: z.number().int(),
    activeCount: z.number().int(),
    availableCount: z.number().int(),
    warrantyMonthsSnapshot: z.number().int().nullable(),
    warrantyStartAt: z.string().datetime().nullable(),
    warrantyEndAt: z.string().datetime().nullable(),
    warrantyPolicySource: z.enum([
      "CHECKOUT_SNAPSHOT",
      "CURRENT_PRODUCT_POLICY_BACKFILL",
      "UNAVAILABLE",
    ]),
    coverage: z.enum(["IN_WARRANTY", "OUT_OF_WARRANTY", "NO_WARRANTY", "REQUIRES_VERIFICATION"]),
    allowed: z.boolean(),
    reason: z.string().nullable(),
    allowedRequestTypes: z.array(z.enum(["WARRANTY", "TECHNICAL_SUPPORT"])),
  }),
);
const CreateServiceRequest = registry.register(
  "CreateServiceRequest",
  z.object({
    type: z.enum(["WARRANTY", "TECHNICAL_SUPPORT"]),
    subject: z.string().min(1).max(200),
    previousRequestId: z.number().int().positive().optional(),
    items: z
      .array(
        z.object({
          orderDetailId: z.number().int().positive(),
          deviceLabel: z.string().min(1).max(100),
          serialNumber: z.string().min(1).max(100).optional(),
          issueDescription: z.string().min(1).max(5000),
        }),
      )
      .min(1)
      .max(50),
  }),
);
const PaymentInstructions = z.object({
  qrImageUrl: z.string().url(),
  bankCode: z.string(),
  accountNumber: z.string(),
  accountName: z.string(),
  transferCode: z.string(),
});
const Payment = registry.register(
  "Payment",
  z.object({
    id: z.string(),
    orderId: z.number(),
    provider: z.string(),
    method: z.string(),
    status: z.enum(["PENDING", "SUCCEEDED", "EXPIRED", "CANCELLED"]),
    amount: z.number(),
    currency: z.string(),
    expiresAt: z.string().datetime(),
    cancelAfter: z.string().datetime(),
    paidAt: z.string().datetime().nullable(),
    serverTime: z.string().datetime(),
    instructions: PaymentInstructions.nullable(),
  }),
);
const PaymentEvent = registry.register(
  "PaymentEvent",
  z.object({
    id: z.string(),
    provider: z.string(),
    source: z.string(),
    providerEventId: z.string(),
    providerTransactionKey: z.string(),
    paymentId: z.string().nullable(),
    direction: z.string(),
    amount: z.number(),
    currency: z.string(),
    transferCode: z.string().nullable(),
    accountNumber: z.string().nullable(),
    occurredAt: z.string().datetime().nullable(),
    status: z.string(),
    reviewReason: z.string().nullable(),
    note: z.string().nullable(),
    receivedAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
    resolvedById: z.number().nullable(),
  }),
);
const ReviewAuthor = registry.register(
  "ReviewAuthor",
  z.object({ name: z.string(), anonymous: z.boolean() }),
);
const ReviewImage = registry.register(
  "ReviewImage",
  z.object({
    id: z.number(),
    url: z.string().url(),
    mimeType: z.literal("image/webp"),
    width: z.number().int(),
    height: z.number().int(),
    position: z.number().int().min(0).max(255),
  }),
);
const PublicOfficialReply = registry.register(
  "PublicOfficialReply",
  z.object({
    content: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);
const AdminOfficialReply = registry.register(
  "AdminOfficialReply",
  PublicOfficialReply.extend({
    id: z.number(),
    createdBy: z.object({ id: z.number(), username: z.string(), fullName: z.string().nullable() }),
    updatedBy: z.object({ id: z.number(), username: z.string(), fullName: z.string().nullable() }),
  }),
);
const PublicReview = registry.register(
  "PublicReview",
  z.object({
    id: z.number(),
    productId: z.number(),
    rating: z.number().int().min(1).max(5),
    title: z.string().nullable(),
    content: z.string(),
    author: ReviewAuthor,
    verifiedPurchase: z.literal(true),
    images: z.array(ReviewImage),
    helpfulCount: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    officialReply: PublicOfficialReply.nullable(),
  }),
);
const ReviewSummary = registry.register(
  "ReviewSummary",
  z.object({
    productId: z.number(),
    averageRating: z.number().nullable(),
    totalReviews: z.number().int(),
    distribution: z.record(z.enum(["1", "2", "3", "4", "5"]), z.number().int()),
  }),
);
const OwnerReview = registry.register(
  "OwnerReview",
  z.object({
    id: z.number(),
    productId: z.number(),
    rating: z.number().int().min(1).max(5),
    title: z.string().nullable(),
    content: z.string(),
    isAnonymous: z.boolean(),
    status: z.enum(["PUBLISHED", "HIDDEN"]),
    deletedAt: z.string().datetime().nullable(),
    verifiedPurchase: z.literal(true),
    images: z.array(ReviewImage),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);
const ReviewEligibility = registry.register(
  "ReviewEligibility",
  z.object({
    eligible: z.boolean(),
    reason: z
      .enum(["NOT_PURCHASED", "ORDER_NOT_COMPLETED", "PAYMENT_NOT_CONFIRMED", "ALREADY_REVIEWED"])
      .nullable(),
    existingReview: OwnerReview.nullable(),
    willRequireModeration: z.boolean(),
  }),
);
const AdminReviewListItem = registry.register(
  "AdminReviewListItem",
  z.object({
    id: z.number(),
    rating: z.number().int(),
    title: z.string().nullable(),
    content: z.string(),
    isAnonymous: z.boolean(),
    status: z.enum(["PUBLISHED", "HIDDEN"]),
    deletedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    contentUpdatedAt: z.string().datetime(),
    hiddenReason: z.string().nullable(),
    moderatedAt: z.string().datetime().nullable(),
    author: z.object({ id: z.number(), username: z.string(), fullName: z.string().nullable() }),
    product: z.object({ id: z.number(), name: z.string() }),
    purchase: z.object({
      orderId: z.number(),
      orderDetailId: z.number(),
      status: z.string(),
      paymentStatus: z.string(),
      completedAt: z.string().datetime().nullable(),
    }),
    moderatedBy: z
      .object({ id: z.number(), username: z.string(), fullName: z.string().nullable() })
      .nullable(),
    images: z.array(ReviewImage),
    helpfulCount: z.number().int().min(0),
    officialReply: AdminOfficialReply.nullable(),
  }),
);
const AdminReviewDetail = registry.register("AdminReviewDetail", AdminReviewListItem);
const AdminReviewSummary = registry.register(
  "AdminReviewSummary",
  z.object({
    totalReviews: z.number().int(),
    publishedReviews: z.number().int(),
    hiddenReviews: z.number().int(),
    deletedReviews: z.number().int(),
    averageRating: z.number().nullable(),
  }),
);
const HelpfulReviewState = registry.register(
  "HelpfulReviewState",
  z.object({ reviewIds: z.array(z.number().int().positive()) }),
);
const HelpfulMutation = registry.register(
  "HelpfulMutation",
  z.object({
    reviewId: z.number().int().positive(),
    helpfulCount: z.number().int().min(0),
    helpful: z.boolean(),
  }),
);
const PaymentMethods = z.array(
  z.object({ code: z.enum(["COD", "BANK_TRANSFER"]), enabled: z.boolean() }),
);
const adminOrderShape = {
  ...orderShape,
  completedAt: z.string().datetime().nullable(),
  user: z.object({ id: z.number(), username: z.string(), fullName: z.string().nullable() }),
};
const Actor = z.object({ id: z.number(), name: z.string() }).nullable();
const AdminOrder = registry.register("AdminOrder", z.object(adminOrderShape));
const AdminOrderDetail = registry.register(
  "AdminOrderDetail",
  z.object({
    ...adminOrderShape,
    history: z.array(
      z.object({
        fromStatus: z.string().nullable(),
        toStatus: z.string(),
        actor: Actor,
        createdAt: z.string().datetime(),
      }),
    ),
  }),
);
const Role = registry.register(
  "Role",
  z.object({ id: z.number(), name: z.string(), description: z.string().nullable() }),
);
const Dashboard = registry.register(
  "Dashboard",
  z.object({
    userCount: z.number(),
    productCount: z.number(),
    orderCount: z.number(),
    revenue: z.number(),
    ordersByStatus: z.record(z.number()),
    lowStockCount: z.number(),
  }),
);

const SalesReport = registry.register(
  "SalesReport",
  z.object({
    daily: z.array(z.object({ date: z.string(), revenue: z.number(), orders: z.number() })),
    topProducts: z.array(
      z.object({
        productId: z.number(),
        name: z.string(),
        quantity: z.number(),
        revenue: z.number(),
      }),
    ),
    totals: z.object({ revenue: z.number(), orders: z.number() }),
  }),
);

const StockMovement = registry.register(
  "StockMovement",
  z.object({
    id: z.number(),
    productId: z.number(),
    productName: z.string(),
    delta: z.number(),
    balanceBefore: z.number().int().nullable(),
    balanceAfter: z.number().int().nullable(),
    reason: z.string(),
    orderId: z.number().nullable(),
    receiptId: z.string().uuid().nullable(),
    receiptCode: z.string().nullable(),
    actor: Actor,
    note: z.string().nullable(),
    createdAt: z.string().datetime(),
  }),
);
const StockReceiptItem = registry.register(
  "StockReceiptItem",
  z.object({
    id: z.number().int(),
    productId: z.number().int(),
    productName: z.string(),
    image: z.string().nullable(),
    isActive: z.boolean(),
    quantity: z.number().int(),
    unitCost: z.number().int().nullable(),
  }),
);
const StockReceiptSummary = registry.register(
  "StockReceiptSummary",
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    supplierName: z.string().nullable(),
    status: z.enum(["DRAFT", "POSTED"]),
    note: z.string().nullable(),
    createdAt: z.string().datetime(),
    postedAt: z.string().datetime().nullable(),
    createdBy: Actor,
    postedBy: Actor,
    itemCount: z.number().int(),
  }),
);
const StockReceiptDetail = registry.register(
  "StockReceiptDetail",
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    supplierName: z.string().nullable(),
    status: z.enum(["DRAFT", "POSTED"]),
    note: z.string().nullable(),
    createdAt: z.string().datetime(),
    postedAt: z.string().datetime().nullable(),
    createdBy: Actor,
    postedBy: Actor,
    items: z.array(StockReceiptItem),
    movements: z.array(StockMovement),
  }),
);
const PromotionSummary = registry.register(
  "PromotionSummary",
  z.object({
    id: z.number(),
    kind: z.enum(["COUPON", "AUTOMATIC", "FLASH_SALE"]),
    state: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]),
    effectiveState: z.enum([
      "DRAFT",
      "ACTIVE",
      "PAUSED",
      "ENDED",
      "SCHEDULED",
      "RUNNING",
      "EXPIRED",
    ]),
    name: z.string(),
    discountKind: z.enum(["PERCENT", "FIXED"]),
    discountValue: z.number().int(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    coupon: z
      .object({
        code: z.string(),
        scope: z.enum(["ORDER", "PRODUCT"]),
        maxUses: z.number().nullable(),
        usedCount: z.number(),
        isPublic: z.boolean(),
      })
      .nullable(),
    priority: z.number().nullable(),
    redemptionCount: z.number(),
  }),
);
const PromotionDetail = registry.register(
  "PromotionDetail",
  PromotionSummary.extend({
    description: z.string().nullable(),
    activatedAt: z.string().datetime().nullable(),
    pricingVersion: z.number(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    createdBy: Actor,
    updatedBy: Actor,
    lockedFields: z.array(z.string()),
    products: z.array(z.object({ id: z.number(), name: z.string(), image: z.string().nullable() })),
    automatic: z
      .object({
        priority: z.number(),
        stackableWithCoupon: z.boolean(),
        targetProductIds: z.array(z.number()),
      })
      .nullable(),
    flashSale: z
      .object({
        priority: z.number(),
        stackableWithCoupon: z.boolean(),
        showRemainingQuota: z.boolean(),
        quotas: z.array(
          z.object({
            productId: z.number(),
            totalQuota: z.number(),
            claimedUnits: z.number(),
            remainingQuota: z.number(),
            maxUnitsPerUser: z.number(),
          }),
        ),
      })
      .nullable(),
  }),
);
const PromotionRedemption = registry.register(
  "PromotionRedemption",
  z.object({
    id: z.number(),
    promotionId: z.number(),
    user: z.object({ id: z.number(), username: z.string(), fullName: z.string().nullable() }),
    orderId: z.number(),
    orderStatus: z.string(),
    orderTotal: z.number(),
    discountAmount: z.number(),
    status: z.enum(["APPLIED", "REVERSED"]),
    createdAt: z.string().datetime(),
    reversedAt: z.string().datetime().nullable(),
    reverseReason: z.string().nullable(),
  }),
);
const PromotionStats = registry.register(
  "PromotionStats",
  z.object({
    promotionId: z.number(),
    kind: z.enum(["COUPON", "AUTOMATIC", "FLASH_SALE"]),
    redemptionCount: z.number(),
    activeUsageCount: z.number(),
    totalDiscountAmount: z.number(),
    totalQuota: z.number().optional(),
    claimedUnits: z.number().optional(),
    remainingUnits: z.number().optional(),
    releasedUnits: z.number().optional(),
    completedUnits: z.number().optional(),
    allocationCount: z.number().optional(),
    breakdown: z.array(z.record(z.number())).optional(),
  }),
);
const FlashSaleAllocation = registry.register(
  "FlashSaleAllocation",
  z.object({
    id: z.number(),
    promotionId: z.number(),
    productId: z.number(),
    product: z.object({ id: z.number(), name: z.string() }),
    user: z.object({ id: z.number(), username: z.string(), fullName: z.string().nullable() }),
    orderId: z.number(),
    orderStatus: z.string(),
    orderDetailId: z.number(),
    quantity: z.number(),
    discountAmount: z.number(),
    status: z.enum(["CLAIMED", "RELEASED"]),
    createdAt: z.string().datetime(),
    releasedAt: z.string().datetime().nullable(),
    releaseReason: z.string().nullable(),
  }),
);

const binary = z.string().openapi({ type: "string", format: "binary" });
const data = (schema: z.ZodTypeAny) => z.object({ data: schema });
const page = (schema: z.ZodTypeAny) => z.object({ data: z.array(schema), meta: Meta });
const json = (schema: z.ZodTypeAny) => ({
  required: true,
  content: { "application/json": { schema } },
});
const multipart = (schema: z.ZodTypeAny) => ({
  content: { "multipart/form-data": { schema } },
});
const userData = data(z.object({ user: User }));

type Op = {
  method: RouteConfig["method"];
  path: string;
  summary: string;
  tag: string;
  auth?: "optional" | "user" | "admin";
  request?: RouteConfig["request"];
  ok: [status: number, description: string, schema?: z.ZodTypeAny];
  additionalOk?: Array<[status: number, description: string, schema?: z.ZodTypeAny]>;
  errors?: Record<number, string>;
  csv?: boolean;
};

const op = (o: Op) => {
  const errors: Record<number, string> = {
    ...(o.auth ? { 401: "Not authenticated" } : {}),
    ...(o.auth === "admin" ? { 403: "Not an admin" } : {}),
    ...o.errors,
  };
  const successResponses = [o.ok, ...(o.additionalOk ?? [])];
  registry.registerPath({
    method: o.method,
    path: o.path,
    summary: o.summary,
    tags: [o.tag],
    ...(o.auth === "optional"
      ? { security: [{}, ...secured] }
      : o.auth
        ? { security: secured }
        : {}),
    request: o.request,
    responses: {
      ...Object.fromEntries(
        successResponses.map(([successStatus, successDescription, successSchema]) => [
          successStatus,
          o.csv
            ? { description: successDescription, content: { "text/csv": { schema: z.string() } } }
            : successSchema
              ? { description: successDescription, ...json(successSchema) }
              : { description: successDescription },
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(errors).map(([code, d]) => [code, { description: d, ...json(ErrorBody) }]),
      ),
    },
  });
};

const v1 = "/api/v1";
const id = { params: idParams };
const productForm = (schema: z.AnyZodObject) =>
  multipart(schema.extend({ image: binary.optional() }));
const avatarForm = (schema: z.AnyZodObject) =>
  multipart(schema.extend({ avatar: binary.optional() }));

// auth
op({
  method: "post",
  path: `${v1}/auth/register`,
  summary: "Register and start a session",
  tag: "auth",
  request: { body: json(registerBody) },
  ok: [201, "Registered; sets auth cookies", userData],
  errors: { 400: "Invalid input", 409: "Email taken" },
});
op({
  method: "put",
  path: `${v1}/admin/reviews/{id}/reply`,
  summary: "Create, update or reactivate an official review reply",
  tag: "admin",
  auth: "admin",
  request: { ...id, body: json(putReviewReplyBody) },
  ok: [200, "Updated", data(AdminOfficialReply)],
  errors: { 400: "Invalid reply content", 404: "Review not found", 409: "Review deleted" },
});
op({
  method: "delete",
  path: `${v1}/admin/reviews/{id}/reply`,
  summary: "Soft-delete an official review reply",
  tag: "admin",
  auth: "admin",
  request: id,
  ok: [204, "Deleted", z.null()],
  errors: { 404: "Review not found", 409: "Review deleted" },
});
op({
  method: "post",
  path: `${v1}/auth/login`,
  summary: "Log in",
  tag: "auth",
  request: { body: json(loginBody) },
  ok: [200, "Logged in; sets auth cookies", userData],
  errors: { 401: "Invalid credentials", 429: "Too many attempts" },
});
op({
  method: "post",
  path: `${v1}/auth/refresh`,
  summary: "Rotate the refresh token (cookie)",
  tag: "auth",
  ok: [200, "New cookies", userData],
  errors: { 401: "Invalid refresh token" },
});
op({
  method: "post",
  path: `${v1}/auth/logout`,
  summary: "Log out",
  tag: "auth",
  ok: [204, "Logged out; cookies cleared"],
});

// users
op({
  method: "get",
  path: `${v1}/users/me`,
  summary: "Current user",
  tag: "users",
  auth: "user",
  ok: [200, "OK", data(Me)],
});
op({
  method: "patch",
  path: `${v1}/users/me`,
  summary: "Update profile",
  tag: "users",
  auth: "user",
  request: { body: avatarForm(updateMeBody) },
  ok: [200, "OK", data(User)],
  errors: { 400: "Invalid input" },
});

// wishlist
op({
  method: "get",
  path: `${v1}/wishlist`,
  summary: "List my wishlist",
  tag: "wishlist",
  auth: "user",
  request: { query: wishlistQuery },
  ok: [200, "OK", page(WishlistItem)],
});
op({
  method: "get",
  path: `${v1}/wishlist/summary`,
  summary: "Get my wishlist summary",
  tag: "wishlist",
  auth: "user",
  ok: [200, "OK", data(WishlistSummary)],
});
op({
  method: "get",
  path: `${v1}/wishlist/status`,
  summary: "Get wishlist status for products",
  tag: "wishlist",
  auth: "user",
  request: { query: wishlistStatusQuery },
  ok: [200, "OK", data(z.array(WishlistStatus))],
  errors: { 400: "Invalid product batch" },
});
op({
  method: "put",
  path: `${v1}/wishlist/items/{productId}`,
  summary: "Add a product to my wishlist",
  tag: "wishlist",
  auth: "user",
  request: { params: wishlistProductParams },
  ok: [200, "OK", data(WishlistItem)],
  errors: { 404: "Product not found", 409: "Product unavailable or wishlist limit reached" },
});
op({
  method: "patch",
  path: `${v1}/wishlist/items/{productId}`,
  summary: "Configure a wishlist price alert",
  tag: "wishlist",
  auth: "user",
  request: { params: wishlistProductParams, body: json(configurePriceAlertBody) },
  ok: [200, "OK", data(WishlistItem)],
  errors: {
    400: "Invalid target price",
    404: "Wishlist item not found",
    409: "Product unavailable",
  },
});
op({
  method: "delete",
  path: `${v1}/wishlist/items/{productId}`,
  summary: "Remove a product from my wishlist",
  tag: "wishlist",
  auth: "user",
  request: { params: wishlistProductParams },
  ok: [204, "Removed"],
});

// notifications
const NotificationPreferences = z.object({
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  webPushEnabled: z.boolean(),
});
op({
  method: "get",
  path: v1 + "/notification-preferences",
  summary: "Get notification preferences",
  tag: "notifications",
  auth: "user",
  ok: [200, "OK", data(NotificationPreferences)],
});
op({
  method: "get",
  path: v1 + "/web-push/config",
  summary: "Get Web Push configuration",
  tag: "notifications",
  auth: "user",
  ok: [200, "OK", data(z.object({ enabled: z.boolean(), publicKey: z.string().nullable() }))],
});
op({
  method: "post",
  path: v1 + "/me/email-verification/request",
  summary: "Request email verification OTP",
  tag: "users",
  auth: "user",
  ok: [202, "Accepted", data(z.object({ accepted: z.boolean() }))],
  errors: { 429: "Rate limited", 503: "Email delivery unavailable" },
});
op({
  method: "post",
  path: v1 + "/me/email-verification/confirm",
  summary: "Confirm email verification OTP",
  tag: "users",
  auth: "user",
  request: { body: json(confirmEmailVerificationBody) },
  ok: [200, "Verified", data(z.object({ verified: z.boolean() }))],
  errors: { 400: "Invalid or expired OTP", 409: "Email changed", 429: "OTP locked" },
});
op({
  method: "get",
  path: v1 + "/admin/notifications/operations",
  summary: "Notification operations",
  tag: "admin",
  auth: "admin",
  ok: [200, "OK", data(z.record(z.unknown()))],
});
op({
  method: "get",
  path: v1 + "/admin/notification-deliveries",
  summary: "List notification deliveries",
  tag: "admin",
  auth: "admin",
  request: { query: notificationDeliveryQuery },
  ok: [200, "OK", page(z.record(z.unknown()))],
});
op({
  method: "post",
  path: v1 + "/admin/notification-deliveries/{id}/retry",
  summary: "Retry a failed notification delivery",
  tag: "admin",
  auth: "admin",
  request: { ...id, body: json(retryNotificationDeliveryBody) },
  ok: [200, "OK", data(z.object({ id: z.number(), status: z.string() }))],
  errors: { 404: "Delivery not found", 409: "Delivery is not retryable" },
});
op({
  method: "post",
  path: v1 + "/web-push/subscriptions",
  summary: "Register the current browser for Web Push",
  tag: "notifications",
  auth: "user",
  request: { body: json(webPushSubscriptionBody) },
  ok: [
    201,
    "Created",
    data(
      z.object({
        id: z.number(),
        userAgent: z.string().nullable(),
        lastSeenAt: z.string().datetime(),
        disabledAt: z.string().datetime().nullable(),
      }),
    ),
  ],
});
op({
  method: "delete",
  path: v1 + "/web-push/subscriptions/{id}",
  summary: "Disable one Web Push subscription",
  tag: "notifications",
  auth: "user",
  request: id,
  ok: [204, "Disabled"],
  errors: { 404: "Push subscription not found" },
});
op({
  method: "delete",
  path: v1 + "/web-push/subscriptions",
  summary: "Disable all Web Push subscriptions",
  tag: "notifications",
  auth: "user",
  ok: [204, "Disabled"],
});
op({
  method: "patch",
  path: v1 + "/notification-preferences",
  summary: "Update notification preferences",
  tag: "notifications",
  auth: "user",
  request: { body: json(updateNotificationPreferencesBody) },
  ok: [200, "OK", data(NotificationPreferences)],
  errors: { 400: "Invalid preferences", 409: "Email is not verified" },
});
op({
  method: "get",
  path: `${v1}/notifications`,
  summary: "List my notifications",
  tag: "notifications",
  auth: "user",
  request: { query: notificationsQuery },
  ok: [200, "OK", page(Notification)],
});
op({
  method: "get",
  path: `${v1}/notifications/unread-count`,
  summary: "Get my unread notification count",
  tag: "notifications",
  auth: "user",
  ok: [200, "OK", data(z.object({ unreadCount: z.number().int() }))],
});
op({
  method: "patch",
  path: `${v1}/notifications/read-all`,
  summary: "Mark all my notifications read",
  tag: "notifications",
  auth: "user",
  ok: [200, "OK", data(z.object({ updatedCount: z.number().int() }))],
});
op({
  method: "patch",
  path: `${v1}/notifications/{id}/read`,
  summary: "Mark one notification read",
  tag: "notifications",
  auth: "user",
  request: id,
  ok: [200, "OK", data(Notification)],
  errors: { 404: "Notification not found" },
});

// products
op({
  method: "post",
  path: `${v1}/advisor/recommend`,
  summary: "Recommend laptops from structured preferences",
  tag: "advisor",
  auth: "optional",
  request: { body: json(AdvisorRequest) },
  ok: [200, "OK", data(AdvisorResult)],
  errors: { 400: "Invalid preferences", 429: "Too many advisor requests" },
});
op({
  method: "get",
  path: `${v1}/products`,
  summary: "List products",
  tag: "products",
  request: { query: listProductsQuery },
  ok: [200, "OK", page(CatalogProduct)],
  errors: { 400: "Invalid filter" },
});
op({
  method: "get",
  path: `${v1}/products/filters`,
  summary: "Filter options",
  tag: "products",
  ok: [200, "OK", data(ProductFilterCatalog)],
});
op({
  method: "get",
  path: `${v1}/products/facets`,
  summary: "Dynamic product facet counts",
  tag: "products",
  request: { query: productFacetsQuery },
  ok: [200, "OK", data(ProductFacets)],
  errors: { 400: "Invalid facet filter" },
});
op({
  method: "get",
  path: `${v1}/products/compare`,
  summary: "Compare 2 to 4 products",
  tag: "products",
  request: { query: compareQuery },
  ok: [200, "Products in the requested order", data(z.array(PricedProduct))],
  errors: { 400: "Invalid ids", 404: "Some products missing or hidden (details.missingIds)" },
});
op({
  method: "get",
  path: `${v1}/products/{id}`,
  summary: "Product detail",
  tag: "products",
  request: id,
  ok: [200, "OK", data(CatalogProduct)],
  errors: { 404: "Not found" },
});
op({
  method: "get",
  path: `${v1}/products/{id}/reviews`,
  summary: "List public product reviews",
  tag: "reviews",
  request: { ...id, query: listProductReviewsQuery },
  ok: [200, "OK", page(PublicReview)],
  errors: { 400: "Invalid filter", 404: "Product not found or hidden" },
});
op({
  method: "get",
  path: `${v1}/products/{id}/reviews/summary`,
  summary: "Get public review summary",
  tag: "reviews",
  request: id,
  ok: [200, "OK", data(ReviewSummary)],
  errors: { 404: "Product not found or hidden" },
});
op({
  method: "get",
  path: `${v1}/products/{id}/reviews/eligibility`,
  summary: "Check review eligibility",
  tag: "reviews",
  auth: "user",
  request: id,
  ok: [200, "OK", data(ReviewEligibility)],
  errors: { 403: "Not eligible" },
});
op({
  method: "post",
  path: `${v1}/products/{id}/reviews`,
  summary: "Create or rewrite a verified purchase review",
  tag: "reviews",
  auth: "user",
  request: { ...id, body: json(createReviewBody) },
  ok: [201, "Created", data(OwnerReview)],
  errors: {
    403: "Not eligible",
    404: "Product not found",
    409: "Already reviewed or public name unavailable",
  },
});
op({
  method: "patch",
  path: `${v1}/reviews/{id}`,
  summary: "Edit my review",
  tag: "reviews",
  auth: "user",
  request: { ...id, body: json(updateReviewBody) },
  ok: [200, "Updated", data(OwnerReview)],
  errors: {
    404: "Review not found",
    409: "Review deleted, state changed, or public name unavailable",
  },
});
op({
  method: "delete",
  path: `${v1}/reviews/{id}`,
  summary: "Soft-delete my review",
  tag: "reviews",
  auth: "user",
  request: id,
  ok: [204, "Deleted"],
  errors: { 404: "Review not found" },
});
op({
  method: "get",
  path: `${v1}/reviews/helpful`,
  summary: "List helpful votes for the current user",
  tag: "reviews",
  auth: "user",
  request: { query: helpfulReviewIdsQuery },
  ok: [200, "OK", data(HelpfulReviewState)],
  errors: { 400: "Invalid or excessive review IDs" },
});
op({
  method: "put",
  path: `${v1}/reviews/{id}/helpful`,
  summary: "Mark a public review as helpful",
  tag: "reviews",
  auth: "user",
  request: id,
  ok: [200, "Updated", data(HelpfulMutation)],
  errors: { 404: "Review not found or not public", 409: "Cannot vote for own review" },
});
op({
  method: "delete",
  path: `${v1}/reviews/{id}/helpful`,
  summary: "Remove the current user's helpful vote",
  tag: "reviews",
  auth: "user",
  request: id,
  ok: [200, "Updated", data(HelpfulMutation)],
  errors: { 404: "Review not found or not public" },
});
op({
  method: "post",
  path: `${v1}/reviews/{id}/images`,
  summary: "Add images to my review",
  tag: "reviews",
  auth: "user",
  request: {
    params: reviewImageParams,
    body: multipart(z.object({ images: z.array(binary).min(1).max(3) })),
  },
  ok: [201, "Created", data(z.array(ReviewImage))],
  errors: {
    404: "Review not found",
    409: "Image limit reached",
    413: "Image too large",
    503: "Storage unavailable",
  },
});
op({
  method: "patch",
  path: `${v1}/reviews/{id}/images/order`,
  summary: "Reorder my review images",
  tag: "reviews",
  auth: "user",
  request: { params: reviewImageParams, body: json(reviewImageOrderBody) },
  ok: [200, "Updated", data(z.array(ReviewImage))],
  errors: { 400: "Invalid image order", 404: "Review not found" },
});
op({
  method: "delete",
  path: `${v1}/reviews/{id}/images/{imageId}`,
  summary: "Delete one of my review images",
  tag: "reviews",
  auth: "user",
  request: { params: reviewImageDeleteParams },
  ok: [204, "Deleted"],
  errors: { 404: "Review or image not found" },
});

// cart
op({
  method: "get",
  path: `${v1}/cart`,
  summary: "Current cart",
  tag: "cart",
  auth: "user",
  ok: [200, "OK", data(Cart)],
});
op({
  method: "post",
  path: `${v1}/cart/items`,
  summary: "Add to cart",
  tag: "cart",
  auth: "user",
  request: { body: json(addItemBody) },
  ok: [200, "Updated cart", data(Cart)],
  errors: { 404: "Product not found", 409: "Out of stock or no longer sold" },
});
op({
  method: "patch",
  path: `${v1}/cart/items/{id}`,
  summary: "Set line quantity",
  tag: "cart",
  auth: "user",
  request: { ...id, body: json(updateItemBody) },
  ok: [200, "Updated cart", data(Cart)],
  errors: { 404: "Not found", 409: "Out of stock or no longer sold" },
});
op({
  method: "delete",
  path: `${v1}/cart/items/{id}`,
  summary: "Remove line",
  tag: "cart",
  auth: "user",
  request: id,
  ok: [204, "Removed"],
  errors: { 404: "Not found" },
});

// orders
op({
  method: "post",
  path: `${v1}/orders`,
  summary: "Checkout the cart",
  tag: "orders",
  auth: "user",
  request: {
    headers: z.object({ "Idempotency-Key": z.string().min(1).max(64) }),
    body: json(placeOrderBody),
  },
  ok: [201, "Created (200 when the key was already used)", data(Order)],
  errors: { 400: "Invalid input", 409: "Cart empty, out of stock or product no longer sold" },
});
op({
  method: "post",
  path: `${v1}/orders/quote`,
  summary: "Quote the authenticated cart",
  tag: "orders",
  auth: "user",
  request: { body: json(quoteOrderBody) },
  ok: [200, "OK", data(PricingQuote)],
  errors: { 409: "Coupon invalid, minimum order not met or cart empty" },
});
op({
  method: "get",
  path: `${v1}/orders/me`,
  summary: "My orders",
  tag: "orders",
  auth: "user",
  request: { query: pageQuery },
  ok: [200, "OK", page(Order)],
});
op({
  method: "get",
  path: `${v1}/orders/checkout-attempt`,
  summary: "Recover a checkout attempt",
  tag: "orders",
  auth: "user",
  request: { headers: z.object({ "Idempotency-Key": z.string().min(1).max(64) }) },
  ok: [200, "Recovered order", data(Order)],
  errors: { 404: "Checkout attempt not found" },
});
op({
  method: "get",
  path: `${v1}/orders/me/{id}`,
  summary: "My order",
  tag: "orders",
  auth: "user",
  request: id,
  ok: [200, "OK", data(Order)],
  errors: { 404: "Not found" },
});
op({
  method: "post",
  path: `${v1}/orders/me/{id}/cancel`,
  summary: "Cancel my pending order",
  tag: "orders",
  auth: "user",
  request: id,
  ok: [200, "Cancelled", data(Order)],
  errors: { 404: "Not found", 409: "Not cancellable" },
});
op({
  method: "get",
  path: `${v1}/after-sales/devices`,
  summary: "List my eligible after-sales devices",
  tag: "after-sales",
  auth: "user",
  request: { query: deviceEligibilityQuery },
  ok: [200, "OK", page(EligibleDevice)],
  errors: { 401: "Unauthenticated" },
});
op({
  method: "post",
  path: `${v1}/after-sales`,
  summary: "Create an after-sales request",
  tag: "after-sales",
  auth: "user",
  request: {
    headers: z.object({ "Idempotency-Key": z.string().min(1).max(64) }),
    body: json(CreateServiceRequest),
  },
  ok: [201, "Created (200 when the key was already used)", data(z.unknown())],
  errors: {
    404: "Order detail not found",
    409: "Order detail ineligible, warranty unavailable, duplicate serial, or idempotency conflict",
  },
});
op({
  method: "get",
  path: `${v1}/after-sales`,
  summary: "List my after-sales requests",
  tag: "after-sales",
  auth: "user",
  request: { query: pageQuery },
  ok: [200, "OK", page(z.unknown())],
  errors: { 401: "Unauthenticated" },
});
op({
  method: "get",
  path: `${v1}/after-sales/{id}`,
  summary: "Get my after-sales request",
  tag: "after-sales",
  auth: "user",
  request: { params: idParams },
  ok: [200, "OK", data(z.unknown())],
  errors: { 404: "Service request not found" },
});
op({
  method: "post",
  path: `${v1}/after-sales/{id}/items/{itemId}/cancel`,
  summary: "Cancel an eligible after-sales device",
  tag: "after-sales",
  auth: "user",
  request: { params: z.object({ id: z.number(), itemId: z.number() }) },
  ok: [200, "Cancelled", data(z.unknown())],
  errors: { 404: "Not found", 409: "Invalid transition" },
});
op({
  method: "post",
  path: `${v1}/after-sales/{id}/items/{itemId}/confirm`,
  summary: "Confirm an after-sales device completion",
  tag: "after-sales",
  auth: "user",
  request: { params: z.object({ id: z.number(), itemId: z.number() }) },
  ok: [200, "Confirmed", data(z.unknown())],
  errors: { 404: "Not found", 409: "Confirmation unavailable" },
});
op({
  method: "post",
  path: `${v1}/after-sales/{id}/items/{itemId}/dispute-completion`,
  summary: "Dispute an after-sales completion",
  tag: "after-sales",
  auth: "user",
  request: {
    params: z.object({ id: z.number(), itemId: z.number() }),
    body: json(
      z.object({ reason: z.enum(["DEVICE_NOT_RECEIVED", "ISSUE_PERSISTS"]), note: z.string() }),
    ),
  },
  ok: [200, "Disputed", data(z.unknown())],
  errors: { 404: "Not found", 409: "Invalid transition" },
});
op({
  method: "patch",
  path: `${v1}/admin/after-sales/{id}/items/{itemId}/status`,
  summary: "Transition an after-sales device",
  tag: "admin",
  auth: "admin",
  request: {
    params: z.object({ id: z.number(), itemId: z.number() }),
    body: json(z.record(z.unknown())),
  },
  ok: [200, "Updated", data(z.unknown())],
  errors: { 404: "Not found", 409: "Invalid transition or version conflict" },
});
op({
  method: "get",
  path: `${v1}/orders/me/{id}/payment`,
  summary: "Payment instructions and status",
  tag: "payments",
  auth: "user",
  request: id,
  ok: [200, "OK", data(Payment)],
  errors: { 404: "Payment not found" },
});
op({
  method: "get",
  path: `${v1}/payments/methods`,
  summary: "Available payment methods",
  tag: "payments",
  auth: "user",
  ok: [200, "OK", data(PaymentMethods)],
});
op({
  method: "post",
  path: `${v1}/webhooks/payments/{provider}`,
  summary: "Receive a payment provider webhook",
  tag: "payments",
  request: { params: paymentProviderParam, body: json(z.record(z.unknown())) },
  ok: [200, "Accepted"],
  errors: { 400: "Invalid payload", 401: "Invalid signature", 404: "Provider not found" },
});
op({
  method: "get",
  path: `${v1}/promotions/available`,
  summary: "List public promotions",
  tag: "promotions",
  ok: [200, "OK", data(z.array(PublicPromotion))],
});
op({
  method: "get",
  path: `${v1}/promotions/flash-sales/availability`,
  summary: "Get Flash Sale availability",
  tag: "promotions",
  request: { query: flashSaleAvailabilityQuery },
  ok: [
    200,
    "OK",
    data(z.object({ serverTime: z.string().datetime(), items: z.array(FlashSaleAvailability) })),
  ],
  errors: { 400: "Invalid product batch" },
});

// admin
op({
  method: "get",
  path: `${v1}/admin/products`,
  summary: "List products",
  tag: "admin",
  auth: "admin",
  request: { query: adminListProductsQuery },
  ok: [200, "OK", page(Product)],
});
op({
  method: "get",
  path: `${v1}/admin/promotions`,
  summary: "List promotions",
  tag: "admin",
  auth: "admin",
  request: { query: adminPromotionQuery },
  ok: [200, "OK", page(PromotionSummary)],
});
op({
  method: "post",
  path: `${v1}/admin/promotions`,
  summary: "Create a promotion draft",
  tag: "admin",
  auth: "admin",
  request: { body: json(createPromotionBody) },
  ok: [201, "Created", data(PromotionDetail)],
  errors: { 400: "Invalid promotion", 409: "Duplicate or invalid commercial configuration" },
});
op({
  method: "get",
  path: `${v1}/admin/promotions/{id}`,
  summary: "Promotion detail",
  tag: "admin",
  auth: "admin",
  request: { params: promotionIdParams },
  ok: [200, "OK", data(PromotionDetail)],
  errors: { 404: "Promotion not found" },
});
op({
  method: "patch",
  path: `${v1}/admin/promotions/{id}`,
  summary: "Update an editable promotion",
  tag: "admin",
  auth: "admin",
  request: { params: promotionIdParams, body: json(updatePromotionBody) },
  ok: [200, "Updated", data(PromotionDetail)],
  errors: { 404: "Promotion not found", 409: "Commercial fields are locked" },
});
op({
  method: "patch",
  path: `${v1}/admin/promotions/{id}/state`,
  summary: "Transition promotion state",
  tag: "admin",
  auth: "admin",
  request: { params: promotionIdParams, body: json(transitionPromotionBody) },
  ok: [200, "Updated", data(PromotionDetail)],
  errors: { 404: "Promotion not found", 409: "Invalid lifecycle transition" },
});
op({
  method: "post",
  path: `${v1}/admin/promotions/{id}/clone`,
  summary: "Clone a promotion as a new draft",
  tag: "admin",
  auth: "admin",
  request: { params: promotionIdParams },
  ok: [201, "Created", data(PromotionDetail)],
  errors: { 404: "Promotion not found" },
});
op({
  method: "get",
  path: `${v1}/admin/promotions/{id}/redemptions`,
  summary: "List promotion redemptions",
  tag: "admin",
  auth: "admin",
  request: { params: promotionIdParams, query: promotionRedemptionQuery },
  ok: [200, "OK", page(PromotionRedemption)],
  errors: { 404: "Promotion not found" },
});
op({
  method: "get",
  path: `${v1}/admin/promotions/{id}/summary`,
  summary: "Promotion summary",
  tag: "admin",
  auth: "admin",
  request: { params: promotionIdParams },
  ok: [200, "OK", data(PromotionStats)],
  errors: { 404: "Promotion not found" },
});
op({
  method: "get",
  path: `${v1}/admin/promotions/{id}/allocations`,
  summary: "List Flash Sale allocation history",
  tag: "admin",
  auth: "admin",
  request: { params: promotionIdParams, query: flashSaleAllocationQuery },
  ok: [200, "OK", page(FlashSaleAllocation)],
  errors: { 403: "Admin only", 404: "Promotion not found" },
});
op({
  method: "post",
  path: `${v1}/admin/products`,
  summary: "Create product",
  tag: "admin",
  auth: "admin",
  request: { body: productForm(productBody) },
  ok: [201, "Created", data(Product)],
  errors: { 400: "Invalid input" },
});
op({
  method: "get",
  path: `${v1}/admin/products/{id}`,
  summary: "Product",
  tag: "admin",
  auth: "admin",
  request: id,
  ok: [200, "OK", data(Product)],
  errors: { 404: "Not found" },
});
op({
  method: "patch",
  path: `${v1}/admin/products/{id}`,
  summary: "Update product",
  tag: "admin",
  auth: "admin",
  request: { ...id, body: productForm(productPatchBody) },
  ok: [200, "OK", data(Product)],
  errors: { 400: "Invalid input", 404: "Not found" },
});
op({
  method: "delete",
  path: `${v1}/admin/products/{id}`,
  summary: "Delete product",
  tag: "admin",
  auth: "admin",
  request: id,
  ok: [204, "Deleted"],
  errors: { 404: "Not found", 409: "Product is in orders; hide it instead" },
});
op({
  method: "get",
  path: `${v1}/admin/users`,
  summary: "List users",
  tag: "admin",
  auth: "admin",
  request: { query: adminListUsersQuery },
  ok: [200, "OK", page(User)],
});
op({
  method: "post",
  path: `${v1}/admin/users`,
  summary: "Create user",
  tag: "admin",
  auth: "admin",
  request: { body: avatarForm(adminCreateUserBody) },
  ok: [201, "Created", data(User)],
  errors: { 400: "Invalid input or role", 409: "Email taken" },
});
op({
  method: "get",
  path: `${v1}/admin/users/{id}`,
  summary: "User",
  tag: "admin",
  auth: "admin",
  request: id,
  ok: [200, "OK", data(User)],
  errors: { 404: "Not found" },
});
op({
  method: "patch",
  path: `${v1}/admin/users/{id}`,
  summary: "Update user",
  tag: "admin",
  auth: "admin",
  request: { ...id, body: avatarForm(adminUpdateUserBody) },
  ok: [200, "OK", data(User)],
  errors: { 400: "Invalid input or role", 404: "Not found", 409: "Cannot change own role" },
});
op({
  method: "delete",
  path: `${v1}/admin/users/{id}`,
  summary: "Delete user",
  tag: "admin",
  auth: "admin",
  request: id,
  ok: [204, "Deleted"],
  errors: { 404: "Not found", 409: "Self or user with orders" },
});
op({
  method: "get",
  path: `${v1}/admin/roles`,
  summary: "List roles",
  tag: "admin",
  auth: "admin",
  ok: [200, "OK", data(z.array(Role))],
});
op({
  method: "get",
  path: `${v1}/admin/orders`,
  summary: "List orders",
  tag: "admin",
  auth: "admin",
  request: { query: adminListOrdersQuery },
  ok: [200, "OK", page(AdminOrder)],
});
op({
  method: "get",
  path: `${v1}/admin/orders/{id}`,
  summary: "Order",
  tag: "admin",
  auth: "admin",
  request: id,
  ok: [200, "OK", data(AdminOrderDetail)],
  errors: { 404: "Not found" },
});
op({
  method: "patch",
  path: `${v1}/admin/orders/{id}/status`,
  summary: "Change order status",
  tag: "admin",
  auth: "admin",
  request: { ...id, body: json(updateStatusBody) },
  ok: [200, "OK", data(Order)],
  errors: { 404: "Not found", 409: "Invalid transition" },
});
op({
  method: "get",
  path: `${v1}/admin/orders/export.csv`,
  summary: "Export orders (same filters as the list) as CSV",
  tag: "admin",
  auth: "admin",
  request: { query: adminExportOrdersQuery },
  ok: [200, "CSV file"],
  csv: true,
  errors: { 400: "Invalid filter or too many rows" },
});
op({
  method: "get",
  path: `${v1}/admin/products/export.csv`,
  summary: "Export products (same filters as the list) as CSV",
  tag: "admin",
  auth: "admin",
  request: { query: adminExportProductsQuery },
  ok: [200, "CSV file"],
  csv: true,
  errors: { 400: "Invalid filter or too many rows" },
});
op({
  method: "get",
  path: `${v1}/admin/inventory/movements/export.csv`,
  summary: "Export the stock ledger as CSV",
  tag: "admin",
  auth: "admin",
  request: { query: exportMovementsQuery },
  ok: [200, "CSV file"],
  csv: true,
  errors: { 400: "Invalid filter or too many rows" },
});
op({
  method: "get",
  path: `${v1}/admin/dashboard`,
  summary: "Dashboard",
  tag: "admin",
  auth: "admin",
  ok: [200, "OK", data(Dashboard)],
});
op({
  method: "get",
  path: `${v1}/admin/dashboard/sales`,
  summary: "Revenue per Vietnam day and top products for completed orders",
  tag: "admin",
  auth: "admin",
  request: { query: salesQuery },
  ok: [200, "OK", data(SalesReport)],
  errors: { 400: "Invalid range" },
});
op({
  method: "get",
  path: `${v1}/admin/payment-events`,
  summary: "Review payment events",
  tag: "admin",
  auth: "admin",
  request: { query: paymentEventQuery },
  ok: [200, "OK", page(PaymentEvent)],
});
op({
  method: "get",
  path: `${v1}/admin/payment-events/{id}`,
  summary: "Payment event detail",
  tag: "admin",
  auth: "admin",
  request: { params: z.object({ id: z.string().uuid() }) },
  ok: [200, "OK", data(PaymentEvent)],
  errors: { 404: "Not found" },
});
op({
  method: "post",
  path: `${v1}/admin/payment-events/{id}/resolve`,
  summary: "Resolve a payment event",
  tag: "admin",
  auth: "admin",
  request: { params: z.object({ id: z.string().uuid() }), body: json(resolvePaymentEventBody) },
  ok: [200, "Resolved", data(PaymentEvent)],
  errors: { 404: "Not found", 409: "Event is not reviewable" },
});
op({
  method: "get",
  path: `${v1}/admin/reviews`,
  summary: "List product reviews for moderation",
  tag: "admin",
  auth: "admin",
  request: { query: adminListReviewsQuery },
  ok: [200, "OK", page(AdminReviewListItem)],
  errors: { 400: "Invalid filter" },
});
op({
  method: "get",
  path: `${v1}/admin/reviews/summary`,
  summary: "Review moderation summary",
  tag: "admin",
  auth: "admin",
  ok: [200, "OK", data(AdminReviewSummary)],
});
op({
  method: "get",
  path: `${v1}/admin/reviews/{id}`,
  summary: "Review moderation detail",
  tag: "admin",
  auth: "admin",
  request: id,
  ok: [200, "OK", data(AdminReviewDetail)],
  errors: { 404: "Review not found" },
});
op({
  method: "patch",
  path: `${v1}/admin/reviews/{id}/moderation`,
  summary: "Hide or restore a review",
  tag: "admin",
  auth: "admin",
  request: { ...id, body: json(moderateReviewBody) },
  ok: [200, "Updated", data(AdminReviewDetail)],
  errors: {
    400: "Invalid moderation input",
    404: "Review not found",
    409: "Review deleted or state changed",
  },
});
op({
  method: "post",
  path: `${v1}/admin/inventory/adjustments`,
  summary: "Adjust stock (restock or stock-take correction)",
  tag: "admin",
  auth: "admin",
  request: {
    headers: z.object({ "Idempotency-Key": z.string().min(1).max(64) }),
    body: json(adjustmentBody),
  },
  ok: [
    201,
    "Adjusted",
    data(z.object({ product: Product, movement: StockMovement, created: z.boolean() })),
  ],
  additionalOk: [
    [
      200,
      "Replayed adjustment",
      data(z.object({ product: Product, movement: StockMovement, created: z.boolean() })),
    ],
  ],
  errors: {
    400: "Invalid input",
    404: "Product not found",
    409: "Stock would go negative or idempotency key was reused",
  },
});
op({
  method: "get",
  path: `${v1}/admin/inventory/movements`,
  summary: "Stock ledger",
  tag: "admin",
  auth: "admin",
  request: { query: listMovementsQuery },
  ok: [200, "OK", page(StockMovement)],
  errors: { 400: "Invalid filter" },
});
op({
  method: "get",
  path: `${v1}/admin/inventory/receipts`,
  summary: "List stock receipts",
  tag: "admin",
  auth: "admin",
  request: { query: listReceiptsQuery },
  ok: [200, "OK", page(StockReceiptSummary)],
  errors: { 400: "Invalid filter" },
});
op({
  method: "post",
  path: `${v1}/admin/inventory/receipts`,
  summary: "Create a draft stock receipt",
  tag: "admin",
  auth: "admin",
  request: { body: json(createReceiptBody) },
  ok: [201, "Created", data(StockReceiptDetail)],
  errors: { 400: "Invalid input", 409: "Product unavailable" },
});
op({
  method: "get",
  path: `${v1}/admin/inventory/receipts/{id}`,
  summary: "Get stock receipt detail",
  tag: "admin",
  auth: "admin",
  request: { params: receiptIdParams },
  ok: [200, "OK", data(StockReceiptDetail)],
  errors: { 404: "Not found" },
});
op({
  method: "patch",
  path: `${v1}/admin/inventory/receipts/{id}`,
  summary: "Update a draft stock receipt",
  tag: "admin",
  auth: "admin",
  request: { params: receiptIdParams, body: json(updateReceiptBody) },
  ok: [200, "Updated", data(StockReceiptDetail)],
  errors: {
    400: "Invalid input",
    404: "Not found",
    409: "Receipt is not a draft or product unavailable",
  },
});
op({
  method: "post",
  path: `${v1}/admin/inventory/receipts/{id}/post`,
  summary: "Post a stock receipt",
  tag: "admin",
  auth: "admin",
  request: { params: receiptIdParams },
  ok: [
    200,
    "Posted or replayed",
    data(
      z.object({
        receipt: StockReceiptDetail,
        movements: z.array(StockMovement),
        created: z.boolean(),
      }),
    ),
  ],
  errors: {
    400: "Receipt is empty",
    404: "Not found",
    409: "Invalid status or product unavailable",
  },
});

export const buildOpenApiDocument = () =>
  new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: { title: "Laptop Shop API", version: "1.0.0" },
  });

export const registerDocs = (app: Express) => {
  if (!env.ENABLE_DOCS) return;
  const doc = buildOpenApiDocument();
  app.get("/api-docs.json", (_req, res) => {
    res.json(doc);
  });
  app.use(
    "/api-docs",
    helmet.contentSecurityPolicy({
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(doc),
  );
};
