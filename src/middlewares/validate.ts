import { RequestHandler } from "express";
import { ZodTypeAny } from "zod";

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

// Express 5 makes req.query a getter, so parsed query and params live on res.locals
export const validate =
  (schemas: Schemas): RequestHandler =>
  async (req, res, next) => {
    if (schemas.params) res.locals.params = await schemas.params.parseAsync(req.params);
    if (schemas.query) res.locals.query = await schemas.query.parseAsync(req.query);
    if (schemas.body) req.body = await schemas.body.parseAsync(req.body ?? {});
    next();
  };
