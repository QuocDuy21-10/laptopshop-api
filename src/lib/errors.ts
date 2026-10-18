import { Prisma } from "@prisma/client";

const DEFAULT_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
};

export class AppError extends Error {
  public code: string;

  constructor(
    message: string,
    public status: number = 500,
    code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code ?? DEFAULT_CODES[status] ?? (status < 500 ? "BAD_REQUEST" : "INTERNAL_ERROR");
  }
}

export const notFound = (what = "Resource") => new AppError(`${what} not found`, 404, "NOT_FOUND");

const hasCode = (e: unknown, code: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;

export const isUniqueViolation = (e: unknown) => hasCode(e, "P2002");
export const isNotFound = (e: unknown) => hasCode(e, "P2025");
