jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

beforeEach(resetPrisma);

const subscription = {
  endpoint: "https://push.example/subscription",
  keys: { p256dh: "p256dh", auth: "auth" },
  userAgent: "test-browser",
};

describe("web push routes", () => {
  it("returns only enabled state and public VAPID key", async () => {
    const response = await request(buildApp())
      .get("/api/v1/web-push/config")
      .set("Cookie", cookieFor(USER));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({ enabled: false, publicKey: null }),
    );
    expect(response.body.data).not.toHaveProperty("privateKey");
  });

  it("upserts a subscription scoped to the authenticated user without returning keys", async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue(null);
    prismaMock.pushSubscription.create.mockResolvedValue({
      id: 4,
      userId: USER.id,
      endpointHash: "hash",
      userAgent: subscription.userAgent,
      disabledAt: null,
      lastSeenAt: new Date(),
    });

    const response = await request(buildApp())
      .post("/api/v1/web-push/subscriptions")
      .set("Cookie", cookieFor(USER))
      .send(subscription);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ id: 4, userAgent: "test-browser" });
    expect(JSON.stringify(response.body)).not.toContain("p256dh");
    expect(prismaMock.pushSubscription.create.mock.calls[0][0].data.userId).toBe(USER.id);
  });

  it("rejects claiming a subscription owned by another user", async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 4,
      userId: USER.id + 1,
    });

    const response = await request(buildApp())
      .post("/api/v1/web-push/subscriptions")
      .set("Cookie", cookieFor(USER))
      .send(subscription);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PUSH_SUBSCRIPTION_OWNED");
  });

  it("disables all subscriptions when the channel is turned off", async () => {
    prismaMock.pushSubscription.updateMany.mockResolvedValue({ count: 2 });

    const response = await request(buildApp())
      .delete("/api/v1/web-push/subscriptions")
      .set("Cookie", cookieFor(USER));

    expect(response.status).toBe(204);
    expect(prismaMock.pushSubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER.id, disabledAt: null } }),
    );
  });
});
