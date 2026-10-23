import type { RequestHandler } from "express";
import { idempotencyKeyHeader } from "lib/idempotency";
import {
  createServiceRequest,
  listMyEligibleDevices,
} from "modules/after-sales/after-sales.service";
import type {
  CreateServiceRequestBody,
  DeviceEligibilityQuery,
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
