import { Router } from "express";
import { idParams } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import fileUploadMiddleware from "middlewares/multer";
import { validate } from "middlewares/validate";
import {
  adminCreateUserBody,
  adminListUsersQuery,
  adminUpdateUserBody,
  updateMeBody,
} from "modules/users/users.schema";
import {
  createUserHandler,
  deleteUserHandler,
  getMeHandler,
  getUserHandler,
  listRolesHandler,
  listUsersHandler,
  updateMeHandler,
  updateUserHandler,
} from "modules/users/users.controller";

export const usersRoutes = Router();

usersRoutes.get("/me", authenticate, getMeHandler);
usersRoutes.patch(
  "/me",
  authenticate,
  fileUploadMiddleware("avatar"),
  validate({ body: updateMeBody }),
  updateMeHandler,
);

const avatarUpload = fileUploadMiddleware("avatar");

export const adminUserRoutes = Router();

adminUserRoutes.get("/", validate({ query: adminListUsersQuery }), listUsersHandler);
adminUserRoutes.post("/", avatarUpload, validate({ body: adminCreateUserBody }), createUserHandler);
adminUserRoutes.get("/:id", validate({ params: idParams }), getUserHandler);
adminUserRoutes.patch(
  "/:id",
  avatarUpload,
  validate({ params: idParams, body: adminUpdateUserBody }),
  updateUserHandler,
);
adminUserRoutes.delete("/:id", validate({ params: idParams }), deleteUserHandler);

export const adminRoleRoutes = Router();

adminRoleRoutes.get("/", listRolesHandler);
