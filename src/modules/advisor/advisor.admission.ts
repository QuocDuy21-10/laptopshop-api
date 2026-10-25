import { randomUUID } from "node:crypto";
import type { RedisClientType } from "redis";
import type { AdvisorRequester } from "modules/advisor/advisor.service";

const ACQUIRE_SCRIPT = `
local clock = redis.call('TIME')
local nowMs = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', nowMs)
local requester = redis.call('GET', KEYS[2])
local global = redis.call('GET', KEYS[1])
if requester and tonumber(requester) >= tonumber(ARGV[1]) then return 0 end
if global and tonumber(global) >= tonumber(ARGV[2]) then return -1 end
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[3]) then return -2 end
local expiry = nowMs + tonumber(ARGV[5])
if requester then redis.call('INCR', KEYS[2]) else redis.call('SET', KEYS[2], 1, 'EX', ARGV[4]) end
if global then redis.call('INCR', KEYS[1]) else redis.call('SET', KEYS[1], 1, 'EX', ARGV[4]) end
redis.call('ZADD', KEYS[3], expiry, ARGV[6])
redis.call('EXPIRE', KEYS[3], math.ceil((tonumber(ARGV[5]) * 2) / 1000))
return 1
`;

const RELEASE_SCRIPT = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

export type AdvisorAdmissionConfig = {
  guestLimit: number;
  userLimit: number;
  globalLimit: number;
  concurrencyLimit: number;
  leaseMs: number;
  keyPrefix?: string;
};

export type AdvisorLease = { release: () => Promise<boolean> };
export type AdvisorAdmissionResult =
  | { status: "acquired"; lease: AdvisorLease }
  | { status: "requester_quota" | "global_quota" | "concurrency" };

export interface AdvisorAdmission {
  acquire(requester: AdvisorRequester): Promise<AdvisorAdmissionResult>;
}

export class RedisAdvisorAdmission implements AdvisorAdmission {
  constructor(
    private readonly client: RedisClientType,
    private readonly config: AdvisorAdmissionConfig,
  ) {}

  async acquire(requester: AdvisorRequester): Promise<AdvisorAdmissionResult> {
    const requesterLimit =
      requester.kind === "guest" ? this.config.guestLimit : this.config.userLimit;
    const prefix = this.config.keyPrefix ?? "advisor";
    const token = randomUUID();
    const concurrencyKey = `${prefix}:concurrency`;
    const result = Number(
      await this.client.eval(ACQUIRE_SCRIPT, {
        keys: [
          `${prefix}:quota:global`,
          `${prefix}:quota:${requester.kind}:${requester.key}`,
          concurrencyKey,
        ],
        arguments: [
          String(requesterLimit),
          String(this.config.globalLimit),
          String(this.config.concurrencyLimit),
          "86400",
          String(this.config.leaseMs),
          token,
        ],
      }),
    );
    if (result === 1) {
      return {
        status: "acquired",
        lease: {
          release: async () =>
            Number(
              await this.client.eval(RELEASE_SCRIPT, {
                keys: [concurrencyKey],
                arguments: [token],
              }),
            ) === 1,
        },
      };
    }
    if (result === 0) return { status: "requester_quota" };
    if (result === -1) return { status: "global_quota" };
    if (result === -2) return { status: "concurrency" };
    throw new Error("Unexpected advisor admission result");
  }
}
