import { RequestHandler } from "express";
import { IdParams } from "lib/http";
import {
  AdminCreateUserBody,
  AdminListUsersQuery,
  AdminUpdateUserBody,
  UpdateMeBody,
} from "modules/users/users.schema";
import {
  createUser,
  deleteUser,
  getMe,
  getUser,
  listRoles,
  listUsers,
  updateMe,
  updateUser,
} from "modules/users/users.service";

export const getMeHandler: RequestHandler = async (req, res) => {
  res.json({ data: await getMe(req.auth!.id) });
};

export const updateMeHandler: RequestHandler = async (req, res) => {
  res.json({ data: await updateMe(req.auth!.id, req.body as UpdateMeBody, req.file?.filename) });
};

export const listUsersHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listUsers(res.locals.query as AdminListUsersQuery);
  res.json({ data: items, meta });
};

export const getUserHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getUser((res.locals.params as IdParams).id) });
};

export const createUserHandler: RequestHandler = async (req, res) => {
  const user = await createUser(req.body as AdminCreateUserBody, req.file?.filename);
  res.status(201).json({ data: user });
};

export const updateUserHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  const input = req.body as AdminUpdateUserBody;
  res.json({ data: await updateUser(req.auth!.id, id, input, req.file?.filename) });
};

export const deleteUserHandler: RequestHandler = async (req, res) => {
  await deleteUser(req.auth!.id, (res.locals.params as IdParams).id);
  res.sendStatus(204);
};

export const listRolesHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await listRoles() });
};
