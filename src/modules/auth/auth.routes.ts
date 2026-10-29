import { Router } from "express";
import { validate } from "middlewares/validate";
import {
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
} from "modules/auth/auth.schema";
import {
  forgotPassword,
  login,
  logout,
  refresh,
  register,
  resetPasswordHandler,
} from "modules/auth/auth.controller";

export const authRoutes = Router();

authRoutes.post("/register", validate({ body: registerBody }), register);
authRoutes.post("/login", validate({ body: loginBody }), login);
authRoutes.post("/forgot-password", validate({ body: forgotPasswordBody }), forgotPassword);
authRoutes.post("/reset-password", validate({ body: resetPasswordBody }), resetPasswordHandler);
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", logout);
