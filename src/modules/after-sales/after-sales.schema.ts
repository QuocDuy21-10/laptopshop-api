import { z } from "zod";
import { pageQuery } from "lib/http";
import { SERVICE_REQUEST_TYPES } from "modules/after-sales/after-sales.types";

export const deviceEligibilityQuery = pageQuery.extend({
  type: z.enum(SERVICE_REQUEST_TYPES),
});
export type DeviceEligibilityQuery = z.infer<typeof deviceEligibilityQuery>;
