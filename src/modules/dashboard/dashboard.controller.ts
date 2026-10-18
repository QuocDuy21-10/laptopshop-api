import { RequestHandler } from "express";
import { getDashboard } from "modules/dashboard/dashboard.service";

export const getDashboardHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getDashboard() });
};
