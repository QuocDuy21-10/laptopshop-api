import "dotenv/config";
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8080),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.string().default("15m"),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
    SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
    ENABLE_DOCS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    GIT_SHA: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === "production" && (e.ADMIN_PASSWORD?.length ?? 0) < 12) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_PASSWORD"],
        message: "ADMIN_PASSWORD (min 12 chars) is required in production",
      });
    }
  })
  .transform((e) => ({ ...e, ADMIN_PASSWORD: e.ADMIN_PASSWORD ?? "123456" }));

export type Env = z.infer<typeof schema>;

export const parseEnv = (source: NodeJS.ProcessEnv): Env => {
  const result = schema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
};

export const env = parseEnv(process.env);
