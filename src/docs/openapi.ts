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
import { ORDER_STATUSES } from "modules/orders/order-status";

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
    gpu: z.string().nullable(),
    ramGb: z.number().int().nullable(),
    storageGb: z.number().int().nullable(),
    screenSizeInch: z.number().nullable(),
    screenResolution: z.string().nullable(),
    refreshRateHz: z.number().int().nullable(),
    batteryWh: z.number().int().nullable(),
    weightGrams: z.number().int().nullable(),
    warrantyMonths: z.number().int().nullable(),
  }),
);
const Option = z.object({ name: z.string(), value: z.string() });
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
    reason: z.string(),
    orderId: z.number().nullable(),
    actor: Actor,
    note: z.string().nullable(),
    createdAt: z.string().datetime(),
  }),
);

const binary = z.string().openapi({ type: "string", format: "binary" });
const data = (schema: z.ZodTypeAny) => z.object({ data: schema });
const page = (schema: z.ZodTypeAny) => z.object({ data: z.array(schema), meta: Meta });
const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const multipart = (schema: z.ZodTypeAny) => ({
  content: { "multipart/form-data": { schema } },
});
const userData = data(z.object({ user: User }));

type Op = {
  method: RouteConfig["method"];
  path: string;
  summary: string;
  tag: string;
  auth?: "user" | "admin";
  request?: RouteConfig["request"];
  ok: [status: number, description: string, schema?: z.ZodTypeAny];
  errors?: Record<number, string>;
  csv?: boolean;
};

const op = (o: Op) => {
  const errors: Record<number, string> = {
    ...(o.auth ? { 401: "Not authenticated" } : {}),
    ...(o.auth === "admin" ? { 403: "Not an admin" } : {}),
    ...o.errors,
  };
  const [status, description, schema] = o.ok;
  registry.registerPath({
    method: o.method,
    path: o.path,
    summary: o.summary,
    tags: [o.tag],
    ...(o.auth ? { security: secured } : {}),
    request: o.request,
    responses: {
      [status]: o.csv
        ? { description, content: { "text/csv": { schema: z.string() } } }
        : schema
          ? { description, ...json(schema) }
          : { description },
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
  ok: [
    200,
    "OK",
    data(z.object({ factoryOptions: z.array(Option), targetOptions: z.array(Option) })),
  ],
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
  method: "post",
  path: `${v1}/admin/inventory/adjustments`,
  summary: "Adjust stock (restock or stock-take correction)",
  tag: "admin",
  auth: "admin",
  request: { body: json(adjustmentBody) },
  ok: [201, "Adjusted", data(z.object({ product: Product, movement: StockMovement }))],
  errors: { 400: "Invalid input", 404: "Product not found", 409: "Stock would go negative" },
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
