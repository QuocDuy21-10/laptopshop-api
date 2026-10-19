import { RequestHandler } from "express";
import { AdjustmentBody, ListMovementsQuery } from "modules/inventory/inventory.schema";
import { adjustStock, listMovements } from "modules/inventory/inventory.service";

export const adjustStockHandler: RequestHandler = async (req, res) => {
  res.status(201).json({ data: await adjustStock(req.auth!.id, req.body as AdjustmentBody) });
};

export const listMovementsHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listMovements(res.locals.query as ListMovementsQuery);
  res.json({ data: items, meta });
};
