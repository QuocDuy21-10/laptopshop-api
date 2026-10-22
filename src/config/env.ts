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
    PRICE_ALERT_INTERVAL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
    PRICE_ALERT_PRODUCT_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    PRICE_ALERT_LOCK_TTL_MS: z.coerce.number().int().min(10_000).max(900_000).default(240_000),
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
    BANK_TRANSFER_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    PAYMENT_PROVIDER: z.enum(["fake", "sepay"]).default("fake"),
    SEPAY_MODE: z.enum(["test", "live"]).default("test"),
    PAYMENT_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    PAYMENT_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(120),
    PAYMENT_EVENT_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().length(64).optional()),
    SEPAY_WEBHOOK_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SEPAY_API_TOKEN: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SEPAY_BANK_CODE: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SEPAY_ACCOUNT_NUMBER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SEPAY_ACCOUNT_NAME: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    ADVISOR_AI_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    GROQ_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GROQ_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GROQ_STRUCTURED_OUTPUT_MODE: z
      .enum(["strict", "best_effort", "json_object"])
      .default("json_object"),
    ADVISOR_AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    ADVISOR_AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(2_000).default(500),
    ADVISOR_GUEST_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
    ADVISOR_USER_DAILY_LIMIT: z.coerce.number().int().positive().default(10),
    ADVISOR_GLOBAL_DAILY_LIMIT: z.coerce.number().int().positive().default(30),
    REVIEW_IMAGES_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    REVIEW_IMAGE_S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().url().optional()),
    REVIEW_IMAGE_S3_REGION: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    REVIEW_IMAGE_S3_BUCKET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    REVIEW_IMAGE_S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    REVIEW_IMAGE_S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    REVIEW_IMAGE_S3_FORCE_PATH_STYLE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    REVIEW_IMAGE_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
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
    if (e.NODE_ENV === "production" && e.BANK_TRANSFER_ENABLED && e.PAYMENT_PROVIDER !== "sepay") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PAYMENT_PROVIDER"],
        message: "PAYMENT_PROVIDER=sepay is required in production",
      });
    }
    if (e.NODE_ENV === "production" && e.BANK_TRANSFER_ENABLED && e.SEPAY_MODE !== "live") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SEPAY_MODE"],
        message: "SEPAY_MODE=live is required in production",
      });
    }
    if (e.BANK_TRANSFER_ENABLED) {
      for (const key of [
        "PAYMENT_EVENT_ENCRYPTION_KEY",
        "SEPAY_WEBHOOK_SECRET",
        "SEPAY_API_TOKEN",
        "SEPAY_BANK_CODE",
        "SEPAY_ACCOUNT_NUMBER",
        "SEPAY_ACCOUNT_NAME",
      ] as const) {
        if (!e[key])
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when BANK_TRANSFER_ENABLED=true`,
          });
      }
    }
    if (e.ADVISOR_AI_ENABLED) {
      if (!e.GROQ_API_KEY)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["GROQ_API_KEY"],
          message: "GROQ_API_KEY is required when ADVISOR_AI_ENABLED=true",
        });
      if (!e.GROQ_MODEL)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["GROQ_MODEL"],
          message: "GROQ_MODEL is required when ADVISOR_AI_ENABLED=true",
        });
    }
    if (e.REVIEW_IMAGES_ENABLED) {
      if (!e.REVIEW_IMAGE_S3_REGION)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["REVIEW_IMAGE_S3_REGION"],
          message: "REVIEW_IMAGE_S3_REGION is required when REVIEW_IMAGES_ENABLED=true",
        });
      if (!e.REVIEW_IMAGE_S3_BUCKET)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["REVIEW_IMAGE_S3_BUCKET"],
          message: "REVIEW_IMAGE_S3_BUCKET is required when REVIEW_IMAGES_ENABLED=true",
        });
    }
    if (Boolean(e.REVIEW_IMAGE_S3_ACCESS_KEY_ID) !== Boolean(e.REVIEW_IMAGE_S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REVIEW_IMAGE_S3_ACCESS_KEY_ID"],
        message: "Review image S3 access key and secret must be configured together",
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
