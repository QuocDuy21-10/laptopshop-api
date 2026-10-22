jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

const auth = () => cookieFor(USER);
const notification = {
  id: 9,
  userId: USER.id,
  productId: null,
  type: "PRICE_DROP" as const,
  title: "Sản phẩm vừa giảm giá",
  message: "Dell XPS đã giảm giá",
  oldPrice: 1_000,
  newPrice: 900,
  dedupeKey: "price-drop:9",
  readAt: null,
  createdAt: new Date("2026-10-22T00:00:00.000Z"),
};

beforeEach(resetPrisma);

describe("Notification authentication and reads", () => {
  it("requires authentication for every notification endpoint", async () => {
    const app = buildApp();
    await expect(request(app).get("/api/v1/notifications")).resolves.toHaveProperty("status", 401);
    await expect(request(app).get("/api/v1/notifications/unread-count")).resolves.toHaveProperty(
      "status",
      401,
    );
    await expect(request(app).patch("/api/v1/notifications/1/read")).resolves.toHaveProperty(
      "status",
      401,
    );
    await expect(request(app).patch("/api/v1/notifications/read-all")).resolves.toHaveProperty(
      "status",
      401,
    );
  });

  it("lists only the caller's notifications and hides private storage fields", async () => {
    prismaMock.notification.count.mockResolvedValue(1);
    prismaMock.notification.findMany.mockResolvedValue([notification]);

    const res = await request(buildApp()).get("/api/v1/notifications").set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({
      id: notification.id,
      productId: null,
      title: notification.title,
    });
    expect(res.body.data[0].userId).toBeUndefined();
    expect(res.body.data[0].dedupeKey).toBeUndefined();
    expect(prismaMock.notification.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: USER.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("counts unread notifications using readAt null and scopes the count", async () => {
    prismaMock.notification.count.mockResolvedValue(3);

    const res = await request(buildApp())
      .get("/api/v1/notifications/unread-count")
      .set("Cookie", auth());

    expect(res.body).toEqual({ data: { unreadCount: 3 } });
    expect(prismaMock.notification.count).toHaveBeenCalledWith({
      where: { userId: USER.id, readAt: null },
    });
  });
});

describe("Notification read mutations", () => {
  it("marks one unread notification read and returns the scoped snapshot", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.notification.findFirst.mockResolvedValue({ ...notification, readAt: new Date() });

    const res = await request(buildApp())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: notification.id, productId: null });
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { id: notification.id, userId: USER.id, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("keeps an already-read notification idempotent", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.notification.findFirst.mockResolvedValue({ ...notification, readAt: new Date() });

    const res = await request(buildApp())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Cookie", auth());

    expect(res.status).toBe(200);
  });

  it("returns 404 when the notification is absent or belongs to another user", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.notification.findFirst.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch(`/api/v1/notifications/${notification.id}/read`)
      .set("Cookie", auth());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
  });

  it("marks all unread notifications read only for the caller", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 4 });

    const res = await request(buildApp())
      .patch("/api/v1/notifications/read-all")
      .set("Cookie", auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { updatedCount: 4 } });
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
