import type { RedisClientType } from "redis";

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export const acquirePriceAlertLock = async (
  redis: RedisClientType,
  key: string,
  token: string,
  ttlMs: number,
) => (await redis.set(key, token, { NX: true, PX: ttlMs })) === "OK";

export const releasePriceAlertLock = async (redis: RedisClientType, key: string, token: string) => {
  const result = await redis.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
  return Number(result) === 1;
};
