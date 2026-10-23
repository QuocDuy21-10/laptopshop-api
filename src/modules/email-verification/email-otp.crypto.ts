import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

export type EncryptedEmailOtp = {
  code: string;
  otpHash: string;
  otpCiphertext: string;
  otpIv: string;
  otpTag: string;
  encryptionKeyVersion: string;
};

const keyFromHex = (keyHex: string) => Buffer.from(keyHex, "hex");

export const createEmailOtp = (
  encryptionKeyHex: string,
  encryptionKeyVersion: string,
): EncryptedEmailOtp => {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const otpHash = createHash("sha256").update(code).digest("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromHex(encryptionKeyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return {
    code,
    otpHash,
    otpCiphertext: ciphertext.toString("base64url"),
    otpIv: iv.toString("base64url"),
    otpTag: cipher.getAuthTag().toString("base64url"),
    encryptionKeyVersion,
  };
};

export const decryptEmailOtp = (
  value: Omit<EncryptedEmailOtp, "code" | "otpHash">,
  keyHex: string,
) => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFromHex(keyHex),
    Buffer.from(value.otpIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(value.otpTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.otpCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

export const verifyEmailOtp = (otpHash: string, code: string) => {
  const expected = Buffer.from(otpHash, "hex");
  const actual = createHash("sha256").update(code).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
