import { prisma } from "config/client";
import { notFound } from "lib/errors";
import { toUserDto, userSelect } from "modules/users/users.mapper";
import { UpdateMeBody } from "modules/users/users.schema";

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
