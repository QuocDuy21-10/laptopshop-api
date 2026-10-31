import type { ReviewImageSyncOperation } from "@prisma/client";

import { prismaMock } from "./prisma";
import type { ReviewImageRow } from "modules/reviews/review-images.mapper";

type State = {
  operation: ReviewImageSyncOperation | null;
  images: ReviewImageRow[];
  review: { id: number; imageVersion: number; deletedAt: Date | null };
};

// Only the database boundary is replaced: rejected callbacks discard all writes.
export function installSyncTransaction(initial: State) {
  const store = { committed: structuredClone(initial) };
  let current = store.committed;
  const matches = (where: Record<string, unknown>) => {
    const op = current.operation;
    if (!op) return false;
    return Object.entries(where).every(([key, value]) => {
      if (key === "userId_reviewId_idempotencyKey") return true;
      return op[key as keyof ReviewImageSyncOperation] === value;
    });
  };
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => {
      current = structuredClone(store.committed);
      try {
        const result = await callback(prismaMock);
        store.committed = structuredClone(current);
        return result;
      } finally {
        current = store.committed;
      }
    },
  );
  prismaMock.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) =>
    sql.join("").includes("review_image_sync_operations")
      ? current.operation
        ? [current.operation]
        : []
      : [current.review],
  );
  prismaMock.reviewImageSyncOperation.findUnique.mockImplementation(async () => current.operation);
  prismaMock.reviewImageSyncOperation.create.mockImplementation(
    async ({ data }: { data: Partial<ReviewImageSyncOperation> }) => {
      current.operation = { ...initial.operation, ...data } as ReviewImageSyncOperation;
      return current.operation;
    },
  );
  prismaMock.reviewImageSyncOperation.update.mockImplementation(
    async ({ data }: { data: Partial<ReviewImageSyncOperation> }) => {
      Object.assign(current.operation!, data);
      return current.operation;
    },
  );
  prismaMock.reviewImageSyncOperation.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<ReviewImageSyncOperation>;
    }) => {
      if (!matches(where)) return { count: 0 };
      Object.assign(current.operation!, data);
      return { count: 1 };
    },
  );
  prismaMock.reviewImage.findMany.mockImplementation(async () =>
    current.images.filter((row) => row.status === "READY" && !row.deletedAt),
  );
  prismaMock.reviewImage.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: { syncOperationId?: number; status?: string };
      data: Partial<ReviewImageRow>;
    }) => {
      const rows = current.images.filter(
        (row) =>
          (where.syncOperationId === undefined || row.syncOperationId === where.syncOperationId) &&
          (where.status === undefined || row.status === where.status),
      );
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
  );
  return store;
}
