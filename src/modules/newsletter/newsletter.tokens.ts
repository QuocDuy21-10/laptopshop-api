import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

import { MAX_DB_INT } from "lib/http";
import { env } from "config/env";

export const hashConfirmToken = (token: string) => createHash("sha256").update(token).digest("hex");

// the plaintext only lives in memory long enough to be emailed; the database keeps the hash
export const createConfirmToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashConfirmToken(token) };
};

// stateless so a later campaign can rebuild every subscriber's unsubscribe link without stored plaintext
const unsubscribeKey = () =>
  createHmac("sha256", env.JWT_SECRET).update("newsletter-unsubscribe-key").digest();

const unsubscribeMac = (id: number) =>
  createHmac("sha256", unsubscribeKey()).update(`newsletter-unsubscribe:${id}`).digest("base64url");

export const createUnsubscribeToken = (id: number) => `${id}.${unsubscribeMac(id)}`;

const UNSUBSCRIBE_TOKEN = /^(\d{1,10})\.([A-Za-z0-9_-]{43})$/;

export const parseUnsubscribeToken = (token: string): number | null => {
  const match = UNSUBSCRIBE_TOKEN.exec(token);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_DB_INT) return null;
  const expected = Buffer.from(unsubscribeMac(id));
  const given = Buffer.from(match[2]);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
};
