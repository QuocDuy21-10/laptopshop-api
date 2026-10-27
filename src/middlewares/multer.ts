import type { NextFunction, Request, Response } from "express";
import { mkdir, writeFile } from "fs/promises";
import multer from "multer";
import path from "path";
import { v4 } from "uuid";
import { AppError } from "lib/errors";

// the stored extension comes from the file's magic bytes, never from the client's name or MIME type
const IMAGE_SIGNATURES = [
  { ext: ".png", magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: ".jpg", magic: Buffer.from([0xff, 0xd8, 0xff]) },
];

const invalidFile = () => new AppError("Only JPEG and PNG images are allowed", 400, "INVALID_FILE");

const fileUploadMiddleware = (fieldName: string, dir: string = "images") => {
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
      const type = IMAGE_SIGNATURES.find(({ magic }) =>
        file.buffer.subarray(0, magic.length).equals(magic),
      );
      if (!type) return next(invalidFile());
      try {
        const destination = path.join("public", dir);
        await mkdir(destination, { recursive: true });
        file.filename = v4() + type.ext;
        file.destination = destination;
        file.path = path.join(destination, file.filename);
        await writeFile(file.path, file.buffer);
        next();
      } catch (error) {
        next(error);
      }
    });
};

export default fileUploadMiddleware;
