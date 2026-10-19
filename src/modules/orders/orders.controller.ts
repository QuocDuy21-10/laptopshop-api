import { RequestHandler } from "express";
import { IdParams, PageQuery } from "lib/http";
import {
  AdminListOrdersQuery,
  idempotencyKeyHeader,
  PlaceOrderBody,
  UpdateStatusBody,
} from "modules/orders/orders.schema";
import {
  cancelMyOrder,
  changeStatus,
  getAnyOrder,
  getMyOrder,
  listAllOrders,
  listMyOrders,
  placeOrder,
} from "modules/orders/orders.service";

export const placeOrderHandler: RequestHandler = async (req, res) => {
  const key = idempotencyKeyHeader.parse(req.get("idempotency-key"));
  const { order, created } = await placeOrder(req.auth!.id, key, req.body as PlaceOrderBody);
  res.status(created ? 201 : 200).json({ data: order });
};

export const listMyOrdersHandler: RequestHandler = async (req, res) => {
  const { items, meta } = await listMyOrders(req.auth!.id, res.locals.query as PageQuery);
  res.json({ data: items, meta });
};

export const getMyOrderHandler: RequestHandler = async (req, res) => {
  res.json({ data: await getMyOrder(req.auth!.id, (res.locals.params as IdParams).id) });
};

export const cancelMyOrderHandler: RequestHandler = async (req, res) => {
  res.json({ data: await cancelMyOrder(req.auth!.id, (res.locals.params as IdParams).id) });
};

export const listAllOrdersHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listAllOrders(res.locals.query as AdminListOrdersQuery);
  res.json({ data: items, meta });
};

export const getAnyOrderHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getAnyOrder((res.locals.params as IdParams).id) });
};

export const updateStatusHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  const { status } = req.body as UpdateStatusBody;
  res.json({ data: await changeStatus(id, status, { actorId: req.auth!.id }) });
};
