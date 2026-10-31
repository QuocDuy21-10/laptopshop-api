import { PrismaClient } from "@prisma/client";

import { env } from "config/env";

// without socket_timeout a query on a hung MySQL connection never returns, so the request hangs;
// an explicit value in DATABASE_URL wins
export const withSocketTimeout = (url: string, seconds = 30) => {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("socket_timeout")) {
    parsed.searchParams.set("socket_timeout", String(seconds));
  }
  return parsed.toString();
};

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: withSocketTimeout(env.DATABASE_URL),
    log: env.NODE_ENV === "development" ? ["query", "info", "warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
