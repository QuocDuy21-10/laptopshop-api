import type { RequestHandler } from "express";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "modules/email-verification/email-verification.service";
import type { ConfirmEmailVerificationBody } from "modules/email-verification/email-verification.schema";

export const requestEmailVerificationHandler: RequestHandler = async (req, res) => {
  await requestEmailVerification(req.auth!.id);
  res.status(202).json({ data: { accepted: true } });
};

export const confirmEmailVerificationHandler: RequestHandler = async (req, res) => {
  res.json({
    data: await confirmEmailVerification(
      req.auth!.id,
      (req.body as ConfirmEmailVerificationBody).code,
    ),
  });
};
