import { z } from "zod";

import { pageQuery } from "lib/http";

export const NEWSLETTER_STATUSES = ["PENDING", "CONFIRMED", "UNSUBSCRIBED"] as const;

const email = z.string().trim().toLowerCase().email().max(254);
const search = z.string().trim().min(1).max(100).optional();

export const subscribeBody = z.object({ email });
export type SubscribeBody = z.infer<typeof subscribeBody>;

export const tokenBody = z.object({ token: z.string().trim().min(1).max(200) });
export type TokenBody = z.infer<typeof tokenBody>;

export const adminListSubscribersQuery = pageQuery.extend({
  status: z.enum(NEWSLETTER_STATUSES).optional(),
  q: search,
});
export type AdminListSubscribersQuery = z.infer<typeof adminListSubscribersQuery>;

export const adminExportSubscribersQuery = z.object({
  status: z.enum(NEWSLETTER_STATUSES).default("CONFIRMED"),
  q: search,
});
export type AdminExportSubscribersQuery = z.infer<typeof adminExportSubscribersQuery>;
