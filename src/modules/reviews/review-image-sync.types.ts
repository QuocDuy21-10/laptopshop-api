export type ReviewImageSyncItem =
  | { kind: "existing"; clientId: string; imageId: number }
  | { kind: "new"; clientId: string; fileIndex: number };

export type ReviewImageSyncManifest = {
  expectedVersion: number;
  items: readonly ReviewImageSyncItem[];
};
