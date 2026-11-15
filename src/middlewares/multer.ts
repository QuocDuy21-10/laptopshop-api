import { v4 } from "uuid";
import multer from "multer";
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";

import { AppError } from "lib/errors";
import {
  isMediaDir,
  removeMediaImage,
  saveMediaImage,
  type MediaDir,
} from "lib/storage/media-images";
import { processUploadedImage } from "lib/images/process-uploaded-image";

// only PNG/JPEG bytes reach sharp, whatever name or MIME type the client claims
const IMAGE_SIGNATURES = [
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0xff, 0xd8, 0xff]),
];

const invalidFile = () => new AppError("Only JPEG and PNG images are allowed", 400, "INVALID_FILE");

// the web maps INVALID_FILE; an oversized image keeps its 413
const toUploadError = (error: unknown) =>
  error instanceof AppError && error.status === 413 ? error : invalidFile();

const fileUploadMiddleware = (fieldName: string, dir: MediaDir = "images") => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 1024 * 1024 * 3, // 3MB
    },
    fileFilter: (req: Express.Request, file: Express.Multer.File, cb: Function) => {
      if (
        file.mimetype === "image/png" ||
        file.mimetype === "image/jpg" ||
        file.mimetype === "image/jpeg"
      ) {
        cb(null, true);
      } else {
        cb(invalidFile(), false);
      }
    },
  }).single(fieldName);

  return (req: Request, res: Response, next: NextFunction) =>
    upload(req, res, async (err?: unknown) => {
      if (err || !req.file) return next(err);
      const file = req.file;
      if (!IMAGE_SIGNATURES.some((magic) => file.buffer.subarray(0, magic.length).equals(magic)))
        return next(invalidFile());
      try {
        const image = await processUploadedImage(file).catch((error: unknown) => {
          throw toUploadError(error);
        });
        const filename = `${v4()}.webp`;
        await saveMediaImage(dir, filename, image.buffer);
        file.filename = filename;
        file.destination = dir;
        next();
      } catch (error) {
        next(error);
      }
    });
};

// a request that fails after its upload was stored must not leave an orphan image behind
export const discardFailedUpload: ErrorRequestHandler = async (err, req, _res, next) => {
  const file = req.file;
  if (file && isMediaDir(file.destination)) await removeMediaImage(file.destination, file.filename);
  next(err);
};

export default fileUploadMiddleware;
