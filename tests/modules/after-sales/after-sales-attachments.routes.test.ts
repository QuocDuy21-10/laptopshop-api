jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { buildApp } from "../../helpers/app";
import { cookieFor, USER } from "../../helpers/auth";
import { prismaMock, resetPrisma } from "../../helpers/prisma";

beforeEach(() => {
  resetPrisma();
  prismaMock.serviceRequestItem.findFirst.mockResolvedValue(null);
});

describe("after-sales attachment routes", () => {
  it("requires authentication before accepting an upload", async () => {
    const res = await request(buildApp({ afterSalesAttachments: { storage: {} as never } })).post(
      "/api/v1/after-sales/9/items/7/attachments",
    );
    expect(res.status).toBe(401);
  });

  it("keeps the upload route scoped to the authenticated request owner", async () => {
    const res = await request(buildApp({ afterSalesAttachments: { storage: {} as never } }))
      .post("/api/v1/after-sales/9/items/7/attachments")
      .set("Cookie", cookieFor(USER))
      .set("Upload-Key", "route-test");
    expect([404, 409, 503]).toContain(res.status);
  });
});
