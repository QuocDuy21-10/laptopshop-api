import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import fileUploadMiddleware from "middlewares/multer";
import { validate } from "middlewares/validate";
import { updateMeBody } from "modules/users/users.schema";
import { getMeHandler, updateMeHandler } from "modules/users/users.controller";

export const usersRoutes = Router();

usersRoutes.get("/me", authenticate, getMeHandler);
usersRoutes.patch(
  "/me",
  authenticate,
  fileUploadMiddleware("avatar"),
  validate({ body: updateMeBody }),
  updateMeHandler,
);
