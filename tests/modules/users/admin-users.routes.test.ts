jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import bcrypt from "bcrypt";
import request from "supertest";
import { prismaError, prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { ADMIN, cookieFor } from "../../helpers/auth";

const row = {
  id: 5,
  username: "u@b.co",
  fullName: "U",
  address: null,
  phone: null,
  accountType: "SYSTEM",
  avatar: null,
  role: { id: 2, name: "USER" },
};
const asAdmin = (req: request.Test) => req.set("Cookie", cookieFor(ADMIN));
const createBody = { username: "u@b.co", password: "password1", fullName: "U", roleId: 2 };

beforeEach(resetPrisma);

describe("GET /api/v1/admin/users", () => {
  it("returns a page of users without passwords", async () => {
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.findMany.mockResolvedValue([row]);
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/users"));
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: 5, role: "USER" });
    expect(JSON.stringify(res.body)).not.toContain("password");
    expect(prismaMock.user.findMany.mock.calls[0][0].select).not.toHaveProperty("password");
  });
});

describe("GET /api/v1/admin/users filters", () => {
  it("searches by email, name or phone and filters by role", async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/users?q=an&role=USER"));
    expect(res.status).toBe(200);
    const where = {
      OR: [
        { username: { contains: "an" } },
        { fullName: { contains: "an" } },
        { phone: { contains: "an" } },
      ],
      role: { name: "USER" },
    };
    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual(where);
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where });
  });
});

describe("POST /api/v1/admin/users", () => {
  it("hashes the password", async () => {
    prismaMock.role.findUnique.mockResolvedValue({ id: 2 });
    prismaMock.user.create.mockResolvedValue(row);
    const res = await asAdmin(request(buildApp()).post("/api/v1/admin/users")).send(createBody);
    expect(res.status).toBe(201);
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(await bcrypt.compare("password1", data.password)).toBe(true);
  });

  it("returns 400 INVALID_ROLE for an unknown role", async () => {
    prismaMock.role.findUnique.mockResolvedValue(null);
    const res = await asAdmin(request(buildApp()).post("/api/v1/admin/users")).send(createBody);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ROLE");
  });

  it("returns 409 EMAIL_TAKEN for a duplicate", async () => {
    prismaMock.role.findUnique.mockResolvedValue({ id: 2 });
    prismaMock.user.create.mockRejectedValue(prismaError("P2002"));
    const res = await asAdmin(request(buildApp()).post("/api/v1/admin/users")).send(createBody);
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/v1/admin/users/:id", () => {
  it("returns 404 for a missing user", async () => {
    prismaMock.user.update.mockRejectedValue(prismaError("P2025"));
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/users/9")).send({
      fullName: "X",
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/admin/users/:id role changes", () => {
  it("refuses to change the caller's own role", async () => {
    prismaMock.role.findUnique.mockResolvedValue({ id: 2 });
    prismaMock.user.findUnique.mockResolvedValue({ roleId: 1 });
    const res = await asAdmin(request(buildApp()).patch(`/api/v1/admin/users/${ADMIN.id}`)).send({
      roleId: 2,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANNOT_CHANGE_OWN_ROLE");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("lets the caller save their own profile when the role is unchanged", async () => {
    prismaMock.role.findUnique.mockResolvedValue({ id: 1 });
    prismaMock.user.findUnique.mockResolvedValue({ roleId: 1 });
    prismaMock.user.update.mockResolvedValue(row);
    const res = await asAdmin(request(buildApp()).patch(`/api/v1/admin/users/${ADMIN.id}`)).send({
      fullName: "X",
      roleId: 1,
    });
    expect(res.status).toBe(200);
    expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("revokes the sessions of a user whose role changes", async () => {
    prismaMock.role.findUnique.mockResolvedValue({ id: 1 });
    prismaMock.user.findUnique.mockResolvedValue({ roleId: 2 });
    prismaMock.user.update.mockResolvedValue(row);
    const res = await asAdmin(request(buildApp()).patch("/api/v1/admin/users/5")).send({
      roleId: 1,
    });
    expect(res.status).toBe(200);
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 5, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe("DELETE /api/v1/admin/users/:id", () => {
  it("refuses to delete the caller", async () => {
    const res = await asAdmin(request(buildApp()).delete(`/api/v1/admin/users/${ADMIN.id}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CANNOT_DELETE_SELF");
  });

  it("refuses to delete a user with orders", async () => {
    prismaMock.order.count.mockResolvedValue(1);
    const res = await asAdmin(request(buildApp()).delete("/api/v1/admin/users/5"));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USER_HAS_ORDERS");
  });

  it("deletes the cart and the user", async () => {
    prismaMock.order.count.mockResolvedValue(0);
    const res = await asAdmin(request(buildApp()).delete("/api/v1/admin/users/5"));
    expect(res.status).toBe(204);
    expect(prismaMock.cart.deleteMany).toHaveBeenCalledWith({ where: { userId: 5 } });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });
});

describe("GET /api/v1/admin/roles", () => {
  it("lists roles", async () => {
    prismaMock.role.findMany.mockResolvedValue([{ id: 1, name: "ADMIN", description: null }]);
    const res = await asAdmin(request(buildApp()).get("/api/v1/admin/roles"));
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe("ADMIN");
  });
});
