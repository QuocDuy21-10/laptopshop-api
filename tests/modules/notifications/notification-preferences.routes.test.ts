jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

beforeEach(resetPrisma);

describe("notification preferences", () => {
  it("accepts a category-only preference update", async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue({
      emailEnabled: false,
      webPushEnabled: false,
      afterSalesEmailEnabled: true,
      afterSalesWebPushEnabled: false,
    });
    const response = await request(buildApp())
      .patch("/api/v1/notification-preferences")
      .set("Cookie", cookieFor(USER))
      .send({ afterSalesEmailEnabled: true });
    expect(response.status).toBe(200);
  });

  it("returns In-App enabled and external channels disabled by default", async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue(null);

    const response = await request(buildApp())
      .get("/api/v1/notification-preferences")
      .set("Cookie", cookieFor(USER));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        inAppEnabled: true,
        emailEnabled: false,
        webPushEnabled: false,
        afterSalesEmailEnabled: false,
        afterSalesWebPushEnabled: false,
      },
    });
    expect(prismaMock.notificationPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: USER.id },
    });
  });

  it("rejects enabling Email when the current email is unverified", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ emailVerifiedAt: null });

    const response = await request(buildApp())
      .patch("/api/v1/notification-preferences")
      .set("Cookie", cookieFor(USER))
      .send({ emailEnabled: true });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("rejects a client userId field and scopes writes to the session user", async () => {
    const response = await request(buildApp())
      .patch("/api/v1/notification-preferences")
      .set("Cookie", cookieFor(USER))
      .send({ userId: 999, webPushEnabled: true });

    expect(response.status).toBe(400);
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
