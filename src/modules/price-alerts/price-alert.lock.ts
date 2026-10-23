import type { RedisClientType } from "redis";

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = [
  "if redis.call('GET', KEYS[1]) == ARGV[1] then",
  "  return redis.call('PEXPIRE', KEYS[1], ARGV[2])",
  "end",
  "return 0",
].join("\n");

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

export const renewPriceAlertLock = async (
  redis: RedisClientType,
  key: string,
  token: string,
  ttlMs: number,
) => {
  const result = await redis.eval(RENEW_SCRIPT, {
    keys: [key],
    arguments: [token, String(ttlMs)],
  });
  return Number(result) === 1;
};
