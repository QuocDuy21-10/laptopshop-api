import request from "supertest";
import { env } from "config/env";
import { buildApp } from "../../helpers/app";

const keys = [
  "STORE_HOTLINE",
  "STORE_SUPPORT_EMAIL",
  "STORE_SUPPORT_HOURS",
  "STORE_VAT_INVOICE",
] as const;
const saved = Object.fromEntries(keys.map((k) => [k, env[k]]));
afterEach(() => Object.assign(env, saved));

describe("GET /api/v1/store-info", () => {
  it("returns nulls and no VAT invoice until configured", async () => {
    const res = await request(buildApp()).get("/api/v1/store-info");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      hotline: null,
      supportEmail: null,
      supportHours: null,
      vatInvoice: false,
      paymentMethods: ["COD"],
    });
  });

  it("returns the configured details", async () => {
    Object.assign(env, {
      STORE_HOTLINE: "1900 0000",
      STORE_SUPPORT_EMAIL: "help@shop.test",
      STORE_SUPPORT_HOURS: "08:00 – 21:00",
      STORE_VAT_INVOICE: true,
    });
    const res = await request(buildApp()).get("/api/v1/store-info");
    expect(res.body.data).toEqual({
      hotline: "1900 0000",
      supportEmail: "help@shop.test",
      supportHours: "08:00 – 21:00",
      vatInvoice: true,
      paymentMethods: ["COD"],
    });
  });
});
