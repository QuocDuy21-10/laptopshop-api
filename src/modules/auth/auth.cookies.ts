import { CookieOptions, Response } from "express";
import { env } from "config/env";
import { IssuedRefresh } from "modules/auth/token.service";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
const REFRESH_PATH = "/api/v1/auth";

const base = (): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  domain: env.COOKIE_DOMAIN,
});

export const setAuthCookies = (res: Response, accessToken: string, refresh: IssuedRefresh) => {
  // the JWT enforces its own short expiry; the cookie lives as long as the session
  res.cookie(ACCESS_COOKIE, accessToken, { ...base(), path: "/", expires: refresh.expiresAt });
  res.cookie(REFRESH_COOKIE, refresh.token, {
    ...base(),
    path: REFRESH_PATH,
    expires: refresh.expiresAt,
  });
};

export const clearAuthCookies = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: REFRESH_PATH });
};
