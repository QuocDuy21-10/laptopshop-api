import crypto from "crypto";
import { z } from "zod";

export const idempotencyKeyHeader = z.string().trim().min(1).max(64);

export const sha256Canonical = (fields: readonly unknown[]) =>
  crypto.createHash("sha256").update(JSON.stringify(fields)).digest("hex");
