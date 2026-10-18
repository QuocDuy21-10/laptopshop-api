import { Prisma } from "@prisma/client";

export const userSelect = {
  id: true,
  username: true,
  fullName: true,
  address: true,
  phone: true,
  accountType: true,
  avatar: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export const toUserDto = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  address: u.address,
  phone: u.phone,
  accountType: u.accountType,
  avatar: u.avatar ? `/images/${u.avatar}` : null,
  role: u.role.name,
});

export type UserDto = ReturnType<typeof toUserDto>;
