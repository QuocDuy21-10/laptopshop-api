import { z } from "zod";
import { pageQuery } from "lib/http";

export const notificationsQuery = pageQuery;
export type NotificationsQuery = z.infer<typeof notificationsQuery>;
