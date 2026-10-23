import type { RequestHandler } from "express";
import { idempotencyKeyHeader } from "lib/idempotency";
import type { PageQuery } from "lib/http";
import {
  createServiceRequest,
  getMyServiceRequest,
  listMyEligibleDevices,
  listMyServiceRequests,
} from "modules/after-sales/after-sales.service";
import {
  cancelMyItem,
  confirmMyItem,
  disputeMyItem,
  transitionItem,
} from "modules/after-sales/after-sales.actions";
import type {
  CreateServiceRequestBody,
  DeviceEligibilityQuery,
  ServiceRequestQuery,
} from "modules/after-sales/after-sales.schema";

export const listEligibleDevicesHandler: RequestHandler = async (req, res) => {
  const result = await listMyEligibleDevices(
    req.auth!.id,
    res.locals.query as DeviceEligibilityQuery,
  );
  res.json({ data: result.items, meta: result.meta });
};

export const createServiceRequestHandler: RequestHandler = async (req, res) => {
  const key = idempotencyKeyHeader.parse(req.get("idempotency-key"));
  const result = await createServiceRequest(
    req.auth!.id,
    key,
    req.body as CreateServiceRequestBody,
  );
  res.status(result.created ? 201 : 200).json({ data: result.request });
};

export const listMyServiceRequestsHandler: RequestHandler = async (req, res) => {
  const result = await listMyServiceRequests(
    req.auth!.id,
    res.locals.query as ServiceRequestQuery & PageQuery,
  );
  res.json({ data: result.items, meta: result.meta });
};

export const getMyServiceRequestHandler: RequestHandler = async (req, res) => {
  const id = Number((res.locals.params as { id: number }).id);
  res.json({ data: await getMyServiceRequest(req.auth!.id, id) });
};

export const cancelMyItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await cancelMyItem(req.auth!.id, id, itemId) });
};

export const confirmMyItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await confirmMyItem(req.auth!.id, id, itemId) });
};

export const disputeMyItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await disputeMyItem(req.auth!.id, id, itemId, req.body) });
};

export const transitionItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await transitionItem({ id: req.auth!.id }, id, itemId, req.body) });
};
