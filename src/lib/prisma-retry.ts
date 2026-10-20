import { Prisma } from "@prisma/client";

type RetryDelay = (attempt: number) => Promise<void>;

const defaultDelay: RetryDelay = async () => {
  await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25)));
};

const isRetryable = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";

export const withPrismaTransactionRetry = async <T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  delay: RetryDelay = defaultDelay,
): Promise<T> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) throw error;
      await delay(attempt);
    }
  }
  throw new Error("unreachable");
};
