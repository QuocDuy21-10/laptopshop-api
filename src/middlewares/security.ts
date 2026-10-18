import { Express } from "express";
import helmet from "helmet";
import compression from "compression";
import { env } from "config/env";

// The EJS pages load scripts/styles/fonts from several CDNs and use inline handlers,
// so the policy allows https: sources and inline code. Tighten when views are cleaned up.
export const applySecurity = (app: Express) => {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https:"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https:"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          // app may run over plain http behind a proxy that terminates TLS
          upgradeInsecureRequests: null,
        },
      },
      hsts: env.NODE_ENV === "production",
    }),
  );
  app.use(compression());
};
