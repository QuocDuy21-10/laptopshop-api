import {
  createReceiptBody,
  generateReceiptCode,
  postReceiptBody,
  updateReceiptBody,
} from "modules/inventory/inventory-receipts.schema";

const item = { productId: 1, quantity: 2, unitCost: 12_000_000 };

describe("inventory receipt schemas", () => {
  it("accepts a bounded receipt with unique items", () => {
    const result = createReceiptBody.safeParse({
      supplierName: "Nhà cung cấp ABC",
      note: "Nhập tháng 10",
      items: [item],
    });
    expect(result.success).toBe(true);
  });

  it.each([0, 101])("rejects a receipt with %s items", (count) => {
    const result = createReceiptBody.safeParse({
      items: Array.from({ length: count }, (_, index) => ({ productId: index + 1, quantity: 1 })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate product IDs after coercion", () => {
    const result = createReceiptBody.safeParse({
      items: [item, { productId: "01", quantity: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects quantities, unit costs and text over their limits", () => {
    expect(createReceiptBody.safeParse({ items: [{ productId: 1, quantity: 0 }] }).success).toBe(
      false,
    );
    expect(
      createReceiptBody.safeParse({ items: [{ productId: 1, quantity: 1, unitCost: -1 }] }).success,
    ).toBe(false);
    expect(
      createReceiptBody.safeParse({ supplierName: "x".repeat(256), items: [item] }).success,
    ).toBe(false);
    expect(createReceiptBody.safeParse({ note: "x".repeat(501), items: [item] }).success).toBe(
      false,
    );
  });

  it("requires a version plus at least one field on patch", () => {
    expect(updateReceiptBody.safeParse({ note: "Đã cập nhật" }).success).toBe(false);
    expect(updateReceiptBody.safeParse({ version: 0 }).success).toBe(false);
    expect(updateReceiptBody.safeParse({ version: 0, items: [] }).success).toBe(false);
    expect(updateReceiptBody.safeParse({ version: -1, note: "x" }).success).toBe(false);
    expect(updateReceiptBody.safeParse({ version: 0, note: "Đã cập nhật" }).success).toBe(true);
  });

  it("requires a version to post", () => {
    expect(postReceiptBody.safeParse({}).success).toBe(false);
    expect(postReceiptBody.safeParse({ version: 2 }).success).toBe(true);
    expect(postReceiptBody.safeParse({ version: 2, extra: 1 }).success).toBe(false);
  });

  it("generates a stable shop-date receipt code", () => {
    expect(generateReceiptCode(new Date("2026-10-20T16:59:00.000Z"), "abcdef12-rest")).toBe(
      "PN-20261020-ABCDEF12",
    );
  });
});
