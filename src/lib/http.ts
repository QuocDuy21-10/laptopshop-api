import { z } from "zod";

export const idParams = z.object({ id: z.coerce.number().int().positive() });
export type IdParams = z.infer<typeof idParams>;

export const pageQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(10),
});
export type PageQuery = z.infer<typeof pageQuery>;

export const pageArgs = ({ page, pageSize }: PageQuery) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export const pageMeta = ({ page, pageSize }: PageQuery, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});
