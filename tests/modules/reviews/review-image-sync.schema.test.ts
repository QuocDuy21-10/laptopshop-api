import { parseReviewImageSyncManifest } from "modules/reviews/review-image-sync.schema";

const mixed = {
  expectedVersion: 4,
  items: [
    { kind: "existing", clientId: "existing-21", imageId: 21 },
    { kind: "new", clientId: "new-c", fileIndex: 0 },
    { kind: "existing", clientId: "existing-22", imageId: 22 },
  ],
};

const errorCode = (run: () => unknown) => {
  try {
    run();
    throw new Error("expected parser to reject");
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe("review image sync manifest", () => {
  it("parses an ordered mixed manifest and preserves item order", () => {
    expect(parseReviewImageSyncManifest(JSON.stringify(mixed), 1)).toEqual(mixed);
  });

  it.each([
    [
      "duplicate client IDs",
      { ...mixed, items: [mixed.items[0], { ...mixed.items[1], clientId: "existing-21" }] },
      1,
    ],
    [
      "duplicate existing image IDs",
      {
        ...mixed,
        items: [{ ...mixed.items[0] }, { kind: "existing", clientId: "existing-22", imageId: 21 }],
      },
      0,
    ],
    [
      "gapped file index",
      { ...mixed, items: [{ kind: "new", clientId: "new-c", fileIndex: 1 }] },
      1,
    ],
    ["unused file", { ...mixed, items: [mixed.items[0], mixed.items[2]] }, 1],
    [
      "too many items",
      {
        expectedVersion: 0,
        items: [0, 1, 2, 3].map((id) => ({
          kind: "existing",
          clientId: `image-${id}`,
          imageId: id + 1,
        })),
      },
      0,
    ],
    ["invalid client ID", { ...mixed, items: [{ ...mixed.items[0], clientId: "not valid" }] }, 1],
    ["negative version", { ...mixed, expectedVersion: -1 }, 1],
  ] as const)("rejects %s", (_label, value, fileCount) => {
    expect(errorCode(() => parseReviewImageSyncManifest(value, fileCount))).toBe(
      "REVIEW_IMAGE_SYNC_MANIFEST_INVALID",
    );
  });

  it("accepts an empty manifest with no files", () => {
    expect(parseReviewImageSyncManifest({ expectedVersion: 0, items: [] }, 0)).toEqual({
      expectedVersion: 0,
      items: [],
    });
  });
});
