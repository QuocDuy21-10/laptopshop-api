import { Express } from "express";
import helmet from "helmet";
import compression from "compression";
import { env } from "config/env";

export const applySecurity = (app: Express) => {
  app.disable("x-powered-by");
  app.use(
    helmet({
      // JSON only: nothing may load or frame; /api-docs relaxes this for Swagger UI
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      // the storefront on shop.com loads product images from api.shop.com (same site, other origin)
      crossOriginResourcePolicy: { policy: "same-site" },
      hsts: env.NODE_ENV === "production",
    }),
  );
  app.use(compression());
};
