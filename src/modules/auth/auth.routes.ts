import { Router } from "express";
import { validate } from "middlewares/validate";
import { loginBody, registerBody } from "modules/auth/auth.schema";
import { login, logout, refresh, register } from "modules/auth/auth.controller";

export const authRoutes = Router();

authRoutes.post("/register", validate({ body: registerBody }), register);
authRoutes.post("/login", validate({ body: loginBody }), login);
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", logout);
