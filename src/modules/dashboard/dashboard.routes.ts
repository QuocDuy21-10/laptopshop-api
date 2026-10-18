import { Router } from "express";
import { getDashboardHandler } from "modules/dashboard/dashboard.controller";

export const dashboardRoutes = Router();

dashboardRoutes.get("/", getDashboardHandler);
