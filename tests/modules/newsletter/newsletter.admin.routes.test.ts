jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, USER, cookieFor } from "../../helpers/auth";

const admin = { Cookie: cookieFor(ADMIN) };
const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  email: `u${id}@b.co`,
  status: "CONFIRMED",
  confirmTokenHash: "secret-hash",
  confirmExpiresAt: null,
  lastConfirmationSentAt: null,
  confirmedAt: new Date("2026-10-02T00:00:00.000Z"),
  unsubscribedAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  ...over,
});

beforeEach(resetPrisma);

describe("admin newsletter subscribers", () => {
  it("requires an admin", async () => {
    expect((await request(buildApp()).get("/api/v1/admin/newsletter/subscribers")).status).toBe(
      401,
    );
    const user = await request(buildApp())
      .get("/api/v1/admin/newsletter/subscribers")
      .set("Cookie", cookieFor(USER));
    expect(user.status).toBe(403);
  });

  it("lists with paging, filters and without token fields", async () => {
    prismaMock.newsletterSubscriber.count.mockResolvedValue(11);
    prismaMock.newsletterSubscriber.findMany.mockResolvedValue([row(2), row(1)]);

    const res = await request(buildApp())
      .get("/api/v1/admin/newsletter/subscribers?status=CONFIRMED&q=b.co&page=2&pageSize=5")
      .set(admin);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      id: 2,
      email: "u2@b.co",
      status: "CONFIRMED",
      confirmedAt: "2026-10-02T00:00:00.000Z",
      unsubscribedAt: null,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(res.body.meta).toMatchObject({ page: 2, pageSize: 5, total: 11 });
    expect(prismaMock.newsletterSubscriber.findMany).toHaveBeenCalledWith({
      where: { status: "CONFIRMED", email: { contains: "b.co" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 5,
      take: 5,
    });
  });

  it("rejects an unknown status", async () => {
    const res = await request(buildApp())
      .get("/api/v1/admin/newsletter/subscribers?status=DELETED")
      .set(admin);
    expect(res.status).toBe(400);
  });

  it("exports confirmed subscribers as CSV by default", async () => {
    prismaMock.newsletterSubscriber.count.mockResolvedValue(2);
    prismaMock.newsletterSubscriber.findMany.mockResolvedValue([
      row(1),
      row(2, { email: "=cmd@b.co" }),
    ]);

    const res = await request(buildApp())
      .get("/api/v1/admin/newsletter/subscribers/export.csv")
      .set(admin);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/newsletter-subscribers-.*\.csv/);
    expect(res.text).toContain("Email");
    expect(res.text).toContain("u1@b.co");
    expect(res.text).toContain("'=cmd@b.co");
    expect(res.text).not.toContain("secret-hash");
    expect(prismaMock.newsletterSubscriber.findMany).toHaveBeenCalledWith({
      where: { status: "CONFIRMED" },
      orderBy: { id: "asc" },
    });
  });

  it("refuses an export that is too large", async () => {
    prismaMock.newsletterSubscriber.count.mockResolvedValue(10_001);
    const res = await request(buildApp())
      .get("/api/v1/admin/newsletter/subscribers/export.csv")
      .set(admin);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EXPORT_TOO_LARGE");
    expect(prismaMock.newsletterSubscriber.findMany).not.toHaveBeenCalled();
  });
});
