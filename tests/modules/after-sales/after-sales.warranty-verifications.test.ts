jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import {
  createWarrantyVerification,
  toAdminWarrantyVerificationDto,
  toCustomerWarrantyVerificationDto,
} from "modules/after-sales/after-sales.warranty-verifications";

beforeEach(resetPrisma);

describe("after-sales warranty verification", () => {
  it("hides verifier and internal note from the customer projection", () => {
    const row = {
      id: 4,
      decision: "IN_WARRANTY" as const,
      warrantyStartAt: new Date("2026-01-01T00:00:00.000Z"),
      warrantyEndAt: new Date("2028-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
      internalNote: "Đã đối chiếu hóa đơn nội bộ",
      verifiedBy: { id: 2, username: "admin@test.local", fullName: "Admin" },
    };

    expect(toCustomerWarrantyVerificationDto(row)).toEqual({
      id: 4,
      decision: "IN_WARRANTY",
      warrantyStartAt: row.warrantyStartAt,
      warrantyEndAt: row.warrantyEndAt,
      verifiedAt: row.createdAt,
    });
    expect(toCustomerWarrantyVerificationDto(row)).not.toHaveProperty("verifiedBy");
    expect(toCustomerWarrantyVerificationDto(row)).not.toHaveProperty("internalNote");
    expect(toAdminWarrantyVerificationDto(row)).toMatchObject({ verifiedBy: row.verifiedBy });
  });

  it("rejects a version-conflicted verification without creating a row", async () => {
    prismaMock.serviceRequestItem.findFirst.mockResolvedValue({
      id: 7,
      serviceRequestId: 9,
      version: 3,
      orderDetailId: 12,
      request: { id: 9, type: "WARRANTY" },
    });
    prismaMock.serviceRequestItem.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      createWarrantyVerification(2, 9, 7, {
        expectedVersion: 3,
        decision: "IN_WARRANTY",
        warrantyStartAt: new Date("2026-01-01T00:00:00.000Z"),
        warrantyEndAt: new Date("2028-01-01T00:00:00.000Z"),
        note: "Đã kiểm tra",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_ITEM_VERSION_CONFLICT" });
    expect(prismaMock.warrantyVerification.create).not.toHaveBeenCalled();
  });
});
