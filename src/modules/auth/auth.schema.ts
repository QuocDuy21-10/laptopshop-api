import { z } from "zod";

export const registerBody = z
  .object({
    fullName: z.string().trim().min(1).max(255),
    username: z.string().trim().email().max(255),
    password: z.string().min(8).max(72),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type RegisterBody = z.infer<typeof registerBody>;

export const loginBody = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(72),
});
export const forgotPasswordBody = z.object({ username: z.string().trim().email().max(255) });
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBody>;

export const resetPasswordBody = z
  .object({
    username: z.string().trim().email().max(255),
    code: z.string().regex(/^\d{6}$/),
    password: z.string().min(8).max(72),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;

export type LoginBody = z.infer<typeof loginBody>;
