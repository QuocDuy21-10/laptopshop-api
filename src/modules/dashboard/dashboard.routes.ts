import { Router } from "express";
import { validate } from "middlewares/validate";
import { getDashboardHandler, getSalesHandler } from "modules/dashboard/dashboard.controller";
import { salesQuery } from "modules/dashboard/dashboard.schema";

export const dashboardRoutes = Router();

dashboardRoutes.get("/", getDashboardHandler);
dashboardRoutes.get("/sales", validate({ query: salesQuery }), getSalesHandler);
