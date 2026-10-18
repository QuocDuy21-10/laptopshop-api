import { prisma } from "config/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "config/env";

const handleGetAllUser = async () => {
  return await prisma.user.findMany();
};

const handleGetUserById = async (id: number) => {
  return await prisma.user.findUnique({
    where: {
      id: +id,
    },
  });
};
const handleUpdateUserById = async (
  id: number,
  fullName: string,
  phone: string,
  address: string,
) => {
  return await prisma.user.update({
    where: {
      id: id,
    },
    data: {
      fullName: fullName,
      phone: phone,
      address: address,
    },
  });
};

const handleDeleteUserById = async (id: number) => {
  return await prisma.user.delete({
    where: {
      id: id,
    },
  });
};

const handleUserLogin = async (username: string, password: string) => {
  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      role: true,
    },
  });

  if (!user) {
    throw new Error("Tên đăng nhập hoặc mật khẩu không đúng");
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new Error("Tên đăng nhập hoặc mật khẩu không đúng");
  }

  const payload = {
    id: user.id,
    username: user.username,
  };

  const secret = env.JWT_SECRET;
  const expiresIn: any = env.JWT_EXPIRES_IN;
  // access token
  const access_token = jwt.sign(payload, secret, {
    expiresIn,
    algorithm: "HS256",
  });
  return access_token;
};

export {
  handleGetAllUser,
  handleGetUserById,
  handleUpdateUserById,
  handleDeleteUserById,
  handleUserLogin,
};
