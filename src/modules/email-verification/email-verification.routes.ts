import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import { confirmEmailVerificationBody } from "modules/email-verification/email-verification.schema";
import {
  confirmEmailVerificationHandler,
  requestEmailVerificationHandler,
} from "modules/email-verification/email-verification.controller";

export const emailVerificationRoutes = Router();

emailVerificationRoutes.use(authenticate);
emailVerificationRoutes.post("/request", requestEmailVerificationHandler);
emailVerificationRoutes.post(
  "/confirm",
  validate({ body: confirmEmailVerificationBody }),
  confirmEmailVerificationHandler,
);
