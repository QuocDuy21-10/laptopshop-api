import sharp from "sharp";
import { AppError } from "lib/errors";

const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_EDGE = 1600;
const MAX_INPUT_PIXELS = 20_000_000;

const invalidImage = (message = "The uploaded file is not a supported image") =>
  new AppError(message, 400, "REVIEW_IMAGE_INVALID_FILE");

const detectSupportedFormat = (buffer: Buffer): "jpeg" | "png" | "webp" | null => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp";
  return null;
};

export type ProcessedReviewImage = {
  buffer: Buffer;
  mimeType: "image/webp";
  byteSize: number;
  width: number;
  height: number;
};

export const processReviewImage = async (
  file: Express.Multer.File,
): Promise<ProcessedReviewImage> => {
  const input = file.buffer;
  if (input.length > MAX_INPUT_BYTES || file.size > MAX_INPUT_BYTES)
    throw new AppError("The uploaded image is too large", 413, "REVIEW_IMAGE_TOO_LARGE");
  if (!detectSupportedFormat(input)) throw invalidImage();

  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
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
    throw invalidImage();
  }
};
