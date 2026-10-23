import { toEligibleDeviceDto } from "modules/after-sales/after-sales.mapper";
import { listEligibleDeviceRows } from "modules/after-sales/after-sales.repository";
import type { DeviceEligibilityQuery } from "modules/after-sales/after-sales.schema";

export const listMyEligibleDevices = async (userId: number, query: DeviceEligibilityQuery) => {
  const result = await listEligibleDeviceRows(userId, query);
  return {
    items: result.rows.map((row) => toEligibleDeviceDto(row, query.type)),
    meta: result.meta,
  };
};
