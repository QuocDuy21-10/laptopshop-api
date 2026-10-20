import { RequestHandler } from "express";
import {
  CreateReceiptBody,
  ListReceiptsQuery,
  ReceiptIdParams,
  UpdateReceiptBody,
} from "modules/inventory/inventory-receipts.schema";
import {
  createReceipt,
  getReceipt,
  listReceipts,
  postReceipt,
  updateReceipt,
} from "modules/inventory/inventory-receipts.service";

export const createReceiptHandler: RequestHandler = async (req, res) => {
  res.status(201).json({
    data: await createReceipt(req.auth!.id, req.body as CreateReceiptBody),
  });
};

export const listReceiptsHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listReceipts(res.locals.query as ListReceiptsQuery);
  res.json({ data: items, meta });
};

export const getReceiptHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getReceipt((res.locals.params as ReceiptIdParams).id) });
};

export const updateReceiptHandler: RequestHandler = async (req, res) => {
  res.json({
    data: await updateReceipt(
      (res.locals.params as ReceiptIdParams).id,
      req.body as UpdateReceiptBody,
    ),
  });
};

export const postReceiptHandler: RequestHandler = async (req, res) => {
  res.json({
    data: await postReceipt((res.locals.params as ReceiptIdParams).id, req.auth!.id),
  });
};
