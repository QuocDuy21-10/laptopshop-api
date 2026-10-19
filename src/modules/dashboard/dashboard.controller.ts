import { RequestHandler } from "express";
import { SalesQuery } from "modules/dashboard/dashboard.schema";
import { getDashboard, getSales } from "modules/dashboard/dashboard.service";

export const getDashboardHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getDashboard() });
};

export const getSalesHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getSales(res.locals.query as SalesQuery) });
};
