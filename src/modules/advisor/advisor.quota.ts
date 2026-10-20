import type { RedisClientType } from "redis";
import type { AdvisorQuota, AdvisorRequester } from "modules/advisor/advisor.service";

const RESERVE_SCRIPT = `
local requester = redis.call('GET', KEYS[2])
local global = redis.call('GET', KEYS[1])
if requester and tonumber(requester) >= tonumber(ARGV[1]) then return 0 end
if global and tonumber(global) >= tonumber(ARGV[2]) then return 0 end
if requester then redis.call('INCR', KEYS[2]) else redis.call('SET', KEYS[2], 1, 'EX', ARGV[3]) end
if global then redis.call('INCR', KEYS[1]) else redis.call('SET', KEYS[1], 1, 'EX', ARGV[3]) end
return 1
`;

export type AdvisorQuotaConfig = { guestLimit: number; userLimit: number; globalLimit: number };

export class RedisAdvisorQuota implements AdvisorQuota {
  constructor(
    private readonly client: RedisClientType,
    private readonly config: AdvisorQuotaConfig,
  ) {}

  async tryReserve(requester: AdvisorRequester): Promise<boolean> {
    const requesterLimit =
      requester.kind === "guest" ? this.config.guestLimit : this.config.userLimit;
    const result = await this.client.eval(RESERVE_SCRIPT, {
      keys: ["advisor:quota:global", `advisor:quota:${requester.kind}:${requester.key}`],
      arguments: [String(requesterLimit), String(this.config.globalLimit), "86400"],
    });
    return Number(result) === 1;
  }
}
