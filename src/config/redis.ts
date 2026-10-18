import { createClient, RedisClientType } from "redis";
import { logger } from "lib/logger";

export const createRedisClient = (url: string): RedisClientType => {
  const client = createClient({ url }) as RedisClientType;
  client.on("error", (err) => logger.error({ err }, "redis error"));
  return client;
};
