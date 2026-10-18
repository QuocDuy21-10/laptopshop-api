import { Prisma, PrismaClient } from "@prisma/client";
import { mockDeep, mockReset } from "jest-mock-extended";

export const prismaMock = mockDeep<PrismaClient>();

export const resetPrisma = () => {
  mockReset(prismaMock);
  // interactive transactions run their callback against the same mock
  prismaMock.$transaction.mockImplementation(((arg: unknown) =>
    typeof arg === "function" ? arg(prismaMock) : Promise.all(arg as Promise<unknown>[])) as any);
};

export const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: "6.3.0" });
