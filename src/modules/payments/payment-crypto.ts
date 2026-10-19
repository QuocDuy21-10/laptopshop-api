import crypto from "node:crypto";

type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  hash: string;
  keyId: string;
};

export const encryptPayload = (raw: Buffer, keyHex: string): EncryptedPayload => {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return {
    ciphertext,
    iv,
    tag: cipher.getAuthTag(),
    hash: crypto.createHash("sha256").update(raw).digest("hex"),
    keyId: keyHex.slice(0, 8),
  };
};

export const decryptPayload = (encrypted: EncryptedPayload, keyHex: string) => {
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), encrypted.iv);
  decipher.setAuthTag(encrypted.tag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
};
