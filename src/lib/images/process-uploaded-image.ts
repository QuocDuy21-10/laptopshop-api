import sharp from "sharp";
import { AppError } from "lib/errors";

const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_EDGE = 1600;
const MAX_INPUT_PIXELS = 20_000_000;

const invalid = (message: string) => new AppError(message, 400, "ATTACHMENT_INVALID_FILE");

const supported = (buffer: Buffer) =>
  (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
  (buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
  (buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP");

export type ProcessedImage = {
  buffer: Buffer;
  mimeType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
};

export const processUploadedImage = async (file: Express.Multer.File): Promise<ProcessedImage> => {
  if (file.size > MAX_INPUT_BYTES || file.buffer.length > MAX_INPUT_BYTES)
    throw new AppError("The uploaded image is too large", 413, "ATTACHMENT_TOO_LARGE");
  if (!supported(file.buffer)) throw invalid("The uploaded file is not a supported image");
  try {
    const { data, info } = await sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({
        width: MAX_OUTPUT_EDGE,
        height: MAX_OUTPUT_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      mimeType: "image/webp",
      byteSize: data.length,
      width: info.width,
      height: info.height,
    };
  } catch {
    throw invalid("The uploaded file is not a supported image");
  }
};
