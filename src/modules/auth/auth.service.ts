import { prisma } from "config/client";
import { ACCOUNT_TYPE } from "config/constant";
import { AppError, isUniqueViolation } from "lib/errors";
import { hashPassword, verifyPassword } from "lib/password";
import { userSelect, UserRow } from "modules/users/users.mapper";
import { RegisterBody } from "modules/auth/auth.schema";

export const registerUser = async (input: RegisterBody): Promise<UserRow> => {
  const role = await prisma.role.findUnique({ where: { name: "USER" } });
  if (!role) throw new AppError("USER role is missing; run the seed", 500);
  try {
    return await prisma.user.create({
      data: {
        fullName: input.fullName,
        username: input.username,
        password: await hashPassword(input.password),
        accountType: ACCOUNT_TYPE.SYSTEM,
        roleId: role.id,
      },
      select: userSelect,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("Email already registered", 409, "EMAIL_TAKEN");
    throw e;
  }
};

export const loginUser = async (username: string, password: string): Promise<UserRow> => {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { ...userSelect, password: true },
  });
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError("Invalid username or password", 401, "INVALID_CREDENTIALS");
  }
  const { password: _hash, ...row } = user;
  return row;
};
