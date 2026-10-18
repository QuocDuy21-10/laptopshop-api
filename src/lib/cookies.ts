import { Request } from "express";

// shortcut: minimal parser for our own JWT/base64url cookies; switch to cookie-parser if signed or arbitrary cookies are needed
export const readCookie = (req: Request, name: string): string | undefined => {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
};
