import * as Sentry from "@sentry/node";
import { env } from "config/env";

// No-op without SENTRY_DSN. Sentry v11 captures Express errors automatically
// (5xx only by default), so no error-handler registration is needed.
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.GIT_SHA,
    tracesSampleRate: 0,
    // never send cookies, auth headers, request bodies (login passwords) or user info
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}
