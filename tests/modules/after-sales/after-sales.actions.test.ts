jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { cancelMyItem, transitionItem } from "modules/after-sales/after-sales.actions";

beforeEach(resetPrisma);

const itemRow = (status: string, version = 3) => ({
  id: 7,
  serviceRequestId: 9,
  status,
  version,
  request: { id: 9, type: "TECHNICAL_SUPPORT", userId: 11 },
});

describe("after-sales item actions", () => {
  it("rejects an admin mutation when the item version changed", async () => {
    prismaMock.serviceRequestItem.findFirst.mockResolvedValue(itemRow("DIAGNOSING"));
    prismaMock.serviceRequestItem.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      transitionItem({ id: 2 }, 9, 7, { to: "IN_SERVICE", expectedVersion: 3 }),
    ).rejects.toMatchObject({ code: "SERVICE_ITEM_VERSION_CONFLICT" });
  });

  it("does not allow a customer to cancel a received device", async () => {
    prismaMock.serviceRequestItem.findFirst.mockResolvedValue(itemRow("RECEIVED"));

    await expect(cancelMyItem(11, 9, 7)).rejects.toMatchObject({
      code: "INVALID_SERVICE_TRANSITION",
    });
  });
});
