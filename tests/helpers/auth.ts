import { AuthUser, signAccessToken } from "modules/auth/token.service";

export const USER: AuthUser = { id: 1, role: "USER" };
export const ADMIN: AuthUser = { id: 99, role: "ADMIN" };

export const cookieFor = (user: AuthUser) => `access_token=${signAccessToken(user)}`;
