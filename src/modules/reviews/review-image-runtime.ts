import type { ObjectStorage } from "lib/storage/object-storage";

export type ReviewImageRuntime = {
  storage: ObjectStorage | null;
  urlTtlSeconds?: number;
  now?: () => Date;
};

export const reviewImageTtl = (runtime: ReviewImageRuntime, fallback: number) =>
  runtime.urlTtlSeconds ?? fallback;

export const reviewImageNow = (runtime: ReviewImageRuntime) => runtime.now?.() ?? new Date();
