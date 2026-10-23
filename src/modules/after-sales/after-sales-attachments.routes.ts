import multer from "multer";
import { Router, type RequestHandler } from "express";
import { AppError } from "lib/errors";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  addServiceAttachments,
  redactServiceAttachment,
  type AttachmentDeps,
} from "modules/after-sales/after-sales.attachments";
import { serviceAttachmentParams, serviceItemParams } from "modules/after-sales/after-sales.schema";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 3 },
});

export const createAfterSalesAttachmentRoutes = (
  deps: AttachmentDeps,
  limiter?: RequestHandler,
) => {
  const router = Router();
  router.post(
    "/:id/items/:itemId/attachments",
    authenticate,
    ...(limiter ? [limiter] : []),
    validate({ params: serviceItemParams }),
    upload.array("images", 3),
    async (req, res) => {
      const { id, itemId } = res.locals.params as { id: number; itemId: number };
      const uploadKey = req.get("upload-key") ?? req.get("idempotency-key");
      if (!uploadKey)
        throw new AppError("Upload-Key header is required", 400, "UPLOAD_KEY_REQUIRED");
      const files = (req.files ?? []) as Express.Multer.File[];
      const role = req.auth!.role === "ADMIN" ? "ADMIN" : "USER";
      res
        .status(201)
        .json({
          data: await addServiceAttachments(
            deps,
            { id: req.auth!.id, role },
            id,
            itemId,
            files,
            uploadKey,
          ),
        });
    },
  );
  router.delete(
    "/:id/attachments/:attachmentId",
    authenticate,
    validate({ params: serviceAttachmentParams }),
    async (req, res) => {
      const { id, attachmentId } = res.locals.params as { id: number; attachmentId: number };
      const role = req.auth!.role === "ADMIN" ? "ADMIN" : "USER";
      await redactServiceAttachment(
        { id: req.auth!.id, role },
        id,
        attachmentId,
        req.get("redaction-reason") ?? "Customer requested removal",
      );
      res.sendStatus(204);
    },
  );
  return router;
};
