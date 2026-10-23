import { z } from "zod";
import { pageQuery } from "lib/http";

export const updateMeBody = z.object({
  fullName: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(255).optional(),
});
export type UpdateMeBody = z.infer<typeof updateMeBody>;

export const adminCreateUserBody = z.object({
  username: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(255).optional(),
  roleId: z.coerce.number().int().positive(),
});
export type AdminCreateUserBody = z.infer<typeof adminCreateUserBody>;

export const adminUpdateUserBody = adminCreateUserBody
  .pick({ username: true, fullName: true, phone: true, address: true, roleId: true })
  .partial();
export type AdminUpdateUserBody = z.infer<typeof adminUpdateUserBody>;

export const adminListUsersQuery = pageQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  role: z.string().trim().min(1).max(100).optional(),
});
export type AdminListUsersQuery = z.infer<typeof adminListUsersQuery>;
