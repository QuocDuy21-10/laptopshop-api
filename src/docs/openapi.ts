import { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { env } from "config/env";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
const secured = [{ bearerAuth: [] }];

const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
});
const idParam = z.object({ id: z.coerce.number().int() });
const message = z.object({ data: z.string() });

const LoginBody = z.object({ username: z.string(), password: z.string() });
const UserBody = z.object({
  fullName: z.string(),
  email: z.string().email(),
  password: z.string(),
});
const UpdateUserBody = z.object({ fullName: z.string(), phone: z.string(), address: z.string() });
const CartBody = z.object({ quantity: z.number().int().positive(), productId: z.number().int() });

registry.registerPath({
  method: "post",
  path: "/api/login",
  summary: "Login, returns a JWT",
  request: { body: json(LoginBody) },
  responses: {
    200: {
      description: "OK",
      ...json(z.object({ data: z.object({ access_token: z.string() }) })),
    },
    401: { description: "Invalid credentials" },
  },
});
registry.registerPath({
  method: "get",
  path: "/api/account",
  summary: "Current account",
  security: secured,
  responses: { 200: { description: "OK" }, 401: { description: "Missing or invalid token" } },
});
registry.registerPath({
  method: "get",
  path: "/api/users",
  summary: "List users",
  security: secured,
  responses: { 200: { description: "OK" }, 401: { description: "Unauthorized" } },
});
registry.registerPath({
  method: "post",
  path: "/api/users",
  summary: "Create user",
  security: secured,
  request: { body: json(UserBody) },
  responses: {
    201: { description: "Created", ...json(message) },
    400: { description: "Validation errors" },
  },
});
registry.registerPath({
  method: "get",
  path: "/api/users/{id}",
  summary: "Get user",
  security: secured,
  request: { params: idParam },
  responses: { 200: { description: "OK" }, 401: { description: "Unauthorized" } },
});
registry.registerPath({
  method: "put",
  path: "/api/users/{id}",
  summary: "Update user",
  security: secured,
  request: { params: idParam, body: json(UpdateUserBody) },
  responses: { 200: { description: "OK", ...json(message) } },
});
registry.registerPath({
  method: "delete",
  path: "/api/users/{id}",
  summary: "Delete user",
  security: secured,
  request: { params: idParam },
  responses: { 200: { description: "OK", ...json(message) } },
});
registry.registerPath({
  method: "post",
  path: "/api/add-product-to-cart",
  summary: "Add product to cart (session user)",
  request: { body: json(CartBody) },
  responses: { 200: { description: "New cart total", ...json(z.object({ data: z.number() })) } },
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
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(doc));
};
