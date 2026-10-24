jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/after-sales/after-sales.notifications", () => ({
  createAfterSalesNotification: jest.fn().mockResolvedValue(undefined),
}));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { addInternalNote, addPublicMessage } from "modules/after-sales/after-sales.events";

beforeEach(() => {
  resetPrisma();
  jest.clearAllMocks();
});

describe("after-sales events", () => {
  it("rejects customer messages after the request is closed", async () => {
    prismaMock.serviceRequest.findFirst.mockResolvedValue({
      id: 9,
      userId: 11,
      status: "CLOSED",
      items: [],
    });

    await expect(
      addPublicMessage({ id: 11, role: "USER" }, 9, { body: "  Xin chào  " }),
    ).rejects.toMatchObject({
      code: "INVALID_SERVICE_TRANSITION",
    });
  });

  it("creates a trimmed public message for an active item", async () => {
    prismaMock.serviceRequest.findFirst.mockResolvedValue({
      id: 9,
      userId: 11,
      status: "IN_PROGRESS",
      items: [{ id: 7, status: "DIAGNOSING" }],
    });
    prismaMock.serviceRequestEvent.create.mockResolvedValue({
      id: 20,
      serviceRequestId: 9,
      serviceRequestItemId: 7,
      kind: "PUBLIC_MESSAGE",
      visibility: "PUBLIC",
      body: "Xin chào",
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
    });

    const result = await addPublicMessage({ id: 11, role: "USER" }, 9, {
      itemId: 7,
      body: "  Xin chào  ",
    });
    expect(result.body).toBe("Xin chào");
    expect(prismaMock.serviceRequestEvent.create.mock.calls[0][0].data.visibility).toBe("PUBLIC");
  });

  it("creates an internal note that is never public", async () => {
    prismaMock.serviceRequest.findFirst.mockResolvedValue({
      id: 9,
      status: "IN_PROGRESS",
      items: [],
    });
    prismaMock.serviceRequestEvent.create.mockResolvedValue({
      id: 21,
      serviceRequestId: 9,
      serviceRequestItemId: null,
      kind: "INTERNAL_NOTE",
      visibility: "INTERNAL",
      body: "Gọi lại khách",
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
    });

    const result = await addInternalNote(2, 9, { body: "  Gọi lại khách  " });
    expect(result.visibility).toBe("INTERNAL");
    expect(result.body).toBe("Gọi lại khách");
  });

  it("creates a public message inside one transaction", async () => {
    prismaMock.serviceRequest.findFirst.mockResolvedValue({
      id: 9,
      userId: 11,
      status: "IN_PROGRESS",
      items: [],
    });
    prismaMock.serviceRequestEvent.create.mockResolvedValue({
      id: 22,
      serviceRequestId: 9,
      serviceRequestItemId: null,
      kind: "PUBLIC_MESSAGE",
      visibility: "PUBLIC",
      body: "Xin chào",
      createdAt: new Date("2026-10-23T00:00:00.000Z"),
    });
    await addPublicMessage({ id: 11, role: "USER" }, 9, { body: "Xin chào" });
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });
});
