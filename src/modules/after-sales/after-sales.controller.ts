import type { RequestHandler } from "express";
import { listMyEligibleDevices } from "modules/after-sales/after-sales.service";
import type { DeviceEligibilityQuery } from "modules/after-sales/after-sales.schema";

export const listEligibleDevicesHandler: RequestHandler = async (req, res) => {
  const result = await listMyEligibleDevices(
    req.auth!.id,
    res.locals.query as DeviceEligibilityQuery,
  );
  res.json({ data: result.items, meta: result.meta });
};
