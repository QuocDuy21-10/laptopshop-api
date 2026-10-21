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
} from "modules/reviews/reviews.schema";

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
  role: z.string(),
};
const User = registry.register("User", z.object(userShape));
const Me = registry.register("Me", z.object({ ...userShape, cartItemCount: z.number() }));
const Product = registry.register(
  "Product",
  z.object({
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
    product: Product,
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
      z.object({ id: z.number(), quantity: z.number(), lineTotal: z.number(), product: Product }),
    ),
    itemCount: z.number(),
    subtotal: z.number(),
  }),
);
const orderShape = {
  id: z.number(),
  status: z.enum(ORDER_STATUSES),
  totalPrice: z.number(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
  receiverName: z.string(),
  receiverAddress: z.string(),
  receiverPhone: z.string(),
  createdAt: z.string().datetime(),
  items: z.array(
    z.object({
      productId: z.number(),
      name: z.string(),
      image: z.string().nullable(),
      price: z.number(),
      quantity: z.number(),
    }),
  ),
};
const Order = registry.register("Order", z.object(orderShape));
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
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
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
    existingReview: z.union([OwnerReview, z.null()]),
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
  ok: [200, "OK", page(Product)],
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
  ok: [200, "Products in the requested order", data(z.array(Product))],
  errors: { 400: "Invalid ids", 404: "Some products missing or hidden (details.missingIds)" },
});
op({
  method: "get",
  path: `${v1}/products/{id}`,
  summary: "Product detail",
  tag: "products",
  request: id,
  ok: [200, "OK", data(Product)],
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
  errors: { 404: "Review not found", 409: "Review deleted or public name unavailable" },
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
  errors: { 400: "Invalid moderation input", 404: "Review not found", 409: "Review deleted" },
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
