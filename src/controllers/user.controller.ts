import { Request, Response } from "express";
import {
  getProducts,
  countTotalProductClientPages,
} from "services/client/item.service";
import {
  getAllUsers,
  handleCreateUser,
  handleDeleteUser,
  getUserById,
  handleUpdateUser,
  getAllRoles,
  handleUpdateProfile,
} from "services/user.service";
const getHomePage = async (req: Request, res: Response) => {
  const { page } = req.query;
  let currentPage = page ? +page : 1;
  if (currentPage <= 0) currentPage = 1;
  const totalPages = await countTotalProductClientPages(8);
  const products = await getProducts(currentPage, 8);
  return res.render("client/home/show.ejs", {
    products,
    totalPages: +totalPages,
    page: +currentPage,
  });
};

const getProfilePage = async (req: Request, res: Response) => {
  const me = req.user;
  if (!me) return res.redirect("/login");
  return res.render("client/me/profile.ejs", {
    me,
  });
};

const postUpdateProfile = async (req: Request, res: Response) => {
  const { id, fullName, phone, address } = req.body;
  const user = req.user;
  const file = req.file;
  const avatar = file?.filename;
  if (!user) return res.redirect("/login");
  await handleUpdateProfile(id, fullName, phone, address, avatar);
  return res.redirect("/profile");
};

const getCreateUserPage = async (req: Request, res: Response) => {
  const roles = await getAllRoles();
  return res.render("admin/user/create.ejs", {
    roles,
  });
};
const postCreateUser = async (req: Request, res: Response) => {
  const { fullName, username, phone, role, address } = req.body;
  const file = req.file;
  const avatar = file?.filename;
  await handleCreateUser(fullName, username, address, phone, avatar, role);
  return res.redirect("/admin/user");
};
const postDeleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  await handleDeleteUser(id);
  return res.redirect("/admin/user");
};
const getViewUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await getUserById(id);
  const roles = await getAllRoles();
  return res.render("admin/user/detail.ejs", {
    id,
    user,
    roles,
  });
};
const postUpdateUser = async (req: Request, res: Response) => {
  const { id, fullName, phone, role, address } = req.body;
  const file = req.file;
  const avatar = file?.filename;
  await handleUpdateUser(id, fullName, phone, role, address, avatar);
  return res.redirect("/admin/user");
};
export {
  getHomePage,
  getCreateUserPage,
  postCreateUser,
  postDeleteUser,
  getViewUser,
  postUpdateUser,
  getProfilePage,
  postUpdateProfile,
};
