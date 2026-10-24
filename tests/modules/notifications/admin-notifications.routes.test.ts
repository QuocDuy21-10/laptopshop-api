jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

beforeEach(resetPrisma);

describe("admin notification operations", () => {
  it("requires admin authentication", async () => {
    await expect(
      request(buildApp()).get("/api/v1/admin/notifications/operations"),
    ).resolves.toHaveProperty("status", 401);
    await expect(
      request(buildApp())
        .get("/api/v1/admin/notifications/operations")
        .set("Cookie", cookieFor(USER)),
    ).resolves.toHaveProperty("status", 403);
  });

  it("returns sanitized operation counts for an admin", async () => {
    prismaMock.wishlistItem.count.mockResolvedValue(4);
    prismaMock.notification.count.mockResolvedValue(8);
    prismaMock.notificationDelivery.count.mockResolvedValue(2);
    prismaMock.outboxEvent.count.mockResolvedValue(3);
    prismaMock.workerHeartbeat.findMany.mockResolvedValue([]);

    const response = await request(buildApp())
      .get("/api/v1/admin/notifications/operations")
      .set("Cookie", cookieFor(ADMIN));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      activeAlerts: 4,
      notifications: 8,
      deadDeliveries: 2,
      pendingOutbox: 3,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/otp|p256dh|endpoint|password/i);
  });

  it("returns stale-aware worker health and sanitized price alert checkpoint metrics", async () => {
    const now = new Date();
    prismaMock.wishlistItem.count.mockResolvedValue(4);
    prismaMock.notification.count.mockResolvedValue(8);
    prismaMock.notificationDelivery.count.mockResolvedValue(2);
    prismaMock.outboxEvent.count.mockResolvedValue(3);
    prismaMock.workerHeartbeat.findMany.mockResolvedValue([
      {
        workerName: "price-alert-worker",
        instanceId: "fresh",
        status: "HEALTHY",
        lastSeenAt: new Date(now.getTime() - 60_000),
      },
      {
        workerName: "price-alert-worker",
        instanceId: "old",
        status: "HEALTHY",
        lastSeenAt: new Date(now.getTime() - 180_000),
      },
    ]);
    prismaMock.workerCheckpoint.findUnique.mockResolvedValue({
      workerName: "price-alert-worker",
      ownerToken: "must-not-leak",
      cursor: { version: 1, lastProductId: 42 },
      cycleStartedAt: now,
      lastStartedAt: now,
      lastCompletedAt: now,
      lastSucceededAt: now,
      lastDurationMs: 1200,
      consecutiveFailures: 0,
      lastErrorCode: null,
      lastStats: {
        productsScanned: 4,
        itemsEvaluated: 8,
        notificationsCreated: 2,
        duplicatesSkipped: 1,
        invalidStatesSkipped: 0,
        errors: 0,
      },
      createdAt: now,
      updatedAt: now,
    });

    const response = await request(buildApp())
      .get("/api/v1/admin/notifications/operations")
      .set("Cookie", cookieFor(ADMIN));

    expect(response.status).toBe(200);
    expect(response.body.data.workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: "fresh", isStale: false }),
        expect.objectContaining({ instanceId: "old", isStale: true }),
      ]),
    );
    expect(response.body.data.priceAlertSweep).toMatchObject({
      checkpointProductId: 42,
      lastDurationMs: 1200,
      lastStats: { notificationsCreated: 2 },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/ownerToken|"cursor"/i);
  });

  it("retries a dead delivery with an audit and a new outbox event", async () => {
    prismaMock.notificationDelivery.findUnique.mockResolvedValue({
      id: 9,
      status: "DEAD",
      notificationId: 3,
      channel: "EMAIL",
    });
    prismaMock.notificationDelivery.update.mockResolvedValue({ id: 9, status: "PENDING" });
    prismaMock.notificationDeliveryAudit.create.mockResolvedValue({ id: 1 });
    prismaMock.outboxEvent.create.mockResolvedValue({ id: 2 });

    const response = await request(buildApp())
      .post("/api/v1/admin/notification-deliveries/9/retry")
      .set("Cookie", cookieFor(ADMIN))
      .send({ reason: "Provider recovered" });

    expect(response.status).toBe(200);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(prismaMock.notificationDeliveryAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: ADMIN.id, action: "RETRY" }),
      }),
    );
    expect(prismaMock.outboxEvent.create).toHaveBeenCalled();
  });
});
