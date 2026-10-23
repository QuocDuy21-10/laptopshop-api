import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { ACCOUNT_TYPE } from "config/constant";
import { AppError, isNotFound, isUniqueViolation, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { hashPassword } from "lib/password";
import { toUserDto, userSelect } from "modules/users/users.mapper";
import { invalidateEmailIdentity } from "modules/notifications/notification-preferences.service";
import {
  AdminCreateUserBody,
  AdminListUsersQuery,
  AdminUpdateUserBody,
  UpdateMeBody,
} from "modules/users/users.schema";

export const getMe = async (userId: number) => {
  const [user, cart] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: userSelect }),
    prisma.cartDetail.aggregate({ where: { cart: { userId } }, _sum: { quantity: true } }),
  ]);
  if (!user) throw notFound("User");
  return { ...toUserDto(user), cartItemCount: cart._sum.quantity ?? 0 };
};

export const updateMe = async (userId: number, input: UpdateMeBody, avatar?: string) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { ...input, ...(avatar ? { avatar } : {}) },
    select: userSelect,
  });
  return toUserDto(user);
};

const ensureRole = async (roleId: number) => {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true } });
  if (!role) throw new AppError("Unknown role", 400, "INVALID_ROLE");
};

export const listUsers = async (q: AdminListUsersQuery) => {
  const where: Prisma.UserWhereInput = {
    ...(q.q
      ? {
          OR: [
            { username: { contains: q.q } },
            { fullName: { contains: q.q } },
            { phone: { contains: q.q } },
          ],
        }
      : {}),
    ...(q.role ? { role: { name: q.role } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, select: userSelect, orderBy: { id: "asc" }, ...pageArgs(q) }),
  ]);
  return { items: rows.map(toUserDto), meta: pageMeta(q, total) };
};

export const getUser = async (id: number) => {
  const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!user) throw notFound("User");
  return toUserDto(user);
};

export const createUser = async (input: AdminCreateUserBody, avatar?: string) => {
  await ensureRole(input.roleId);
  try {
    const user = await prisma.user.create({
      data: {
        username: input.username,
        fullName: input.fullName,
        phone: input.phone,
        address: input.address,
        roleId: input.roleId,
        password: await hashPassword(input.password),
        accountType: ACCOUNT_TYPE.SYSTEM,
        ...(avatar ? { avatar } : {}),
      },
      select: userSelect,
    });
    return toUserDto(user);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("Email already registered", 409, "EMAIL_TAKEN");
    throw e;
  }
};

export const updateUser = async (
  actorId: number,
  id: number,
  input: AdminUpdateUserBody,
  avatar?: string,
) => {
  let roleChanged = false;
  let emailChanged = false;
  let previousEmail = "";
  if (input.roleId) {
    await ensureRole(input.roleId);
    const current = await prisma.user.findUnique({
      where: { id },
      select: { roleId: true, username: true },
    });
    roleChanged = current?.roleId !== input.roleId;
    previousEmail = current?.username ?? "";
  }
  if (input.username && !previousEmail) {
    const current = await prisma.user.findUnique({ where: { id }, select: { username: true } });
    previousEmail = current?.username ?? "";
  }
  emailChanged = Boolean(input.username && input.username !== previousEmail);
  // an admin can never demote themselves, so at least one admin always remains
  // shortcut: two admins demoting each other at the same moment can still leave none; recover with seed/ADMIN_PASSWORD, lock the admin rows (SELECT ... FOR UPDATE) once there are many admins
  if (roleChanged && actorId === id) {
    throw new AppError("You cannot change your own role", 409, "CANNOT_CHANGE_OWN_ROLE");
  }
  try {
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { ...input, ...(avatar ? { avatar } : {}) },
        select: userSelect,
      });
      // the role is baked into tokens; forcing a new login applies the new role once the access token expires
      if (roleChanged) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      if (emailChanged) await invalidateEmailIdentity(tx, id, previousEmail);
      return updated;
    });
    return toUserDto(user);
  } catch (e) {
    if (isNotFound(e)) throw notFound("User");
    throw e;
  }
};

export const deleteUser = async (actorId: number, id: number) => {
  if (actorId === id) {
    throw new AppError("You cannot delete your own account", 409, "CANNOT_DELETE_SELF");
  }
  if ((await prisma.order.count({ where: { userId: id } })) > 0) {
    throw new AppError("User has orders", 409, "USER_HAS_ORDERS");
  }
  try {
    await prisma.$transaction([
      prisma.cartDetail.deleteMany({ where: { cart: { userId: id } } }),
      prisma.cart.deleteMany({ where: { userId: id } }),
      prisma.user.delete({ where: { id } }),
    ]);
  } catch (e) {
    if (isNotFound(e)) throw notFound("User");
    throw e;
  }
};

export const listRoles = () =>
  prisma.role.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { id: "asc" },
  });
