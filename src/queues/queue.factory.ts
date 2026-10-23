import { Queue, Worker, createNodeRedisClient, type JobsOptions, type WorkerOptions } from "bullmq";
import { createClient, type RedisClientType } from "redis";

export const createBullMqRedisClient = async (url: string) => {
  const raw = createClient({ url }) as RedisClientType;
  await raw.connect();
  return createNodeRedisClient(raw);
};

export const createQueue = <T>(
  name: string,
  connection: ReturnType<typeof createNodeRedisClient>,
  prefix: string,
) => new Queue<T>(name, { connection, prefix });

export const createWorker = <T>(
  name: string,
  processor: (job: { data: T }) => Promise<unknown>,
  connection: ReturnType<typeof createNodeRedisClient>,
  prefix: string,
  options: Omit<WorkerOptions, "connection"> = {},
) => new Worker<T>(name, processor, { ...options, connection, prefix });

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 604_800, count: 10_000 },
  removeOnFail: { age: 2_592_000, count: 10_000 },
};
