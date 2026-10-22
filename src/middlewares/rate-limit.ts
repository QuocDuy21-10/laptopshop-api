import rateLimit, { ipKeyGenerator, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { RedisClientType } from "redis";

const tooMany = { data: null, message: "Too many requests, please try again later" };
const advisorTooMany = {
  error: { code: "RATE_LIMITED", message: "Too many advisor requests, please try again later" },
};
export const createRedisLimitStore = (client: RedisClientType, prefix: string): Store =>
  new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => client.sendCommand(args) as Promise<any>,
  });

// separate stores (different key prefixes) so the two limiters never share counters
export const createLimiters = (stores?: {
  global?: Store;
  auth?: Store;
  advisor?: Store;
  reviewImages?: Store;
  reviewHelpful?: Store;
}) => ({
  globalLimiter: rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooMany,
    store: stores?.global,
  }),
  authLimiter: rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooMany,
    store: stores?.auth,
  }),
  advisorLimiter: rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: advisorTooMany,
    keyGenerator: (req) => req.advisorRequester?.key ?? ipKeyGenerator(req.ip ?? "0.0.0.0"),
    passOnStoreError: true,
    store: stores?.advisor,
  }),
  reviewImagesLimiter: rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooMany,
    store: stores?.reviewImages,
  }),
  reviewHelpfulLimiter: rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: tooMany,
    keyGenerator: (req) => req.auth?.id?.toString() ?? ipKeyGenerator(req.ip ?? "0.0.0.0"),
    store: stores?.reviewHelpful,
  }),
});
