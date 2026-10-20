jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import type { AppDeps } from "../../../src/app";
import { buildApp } from "../../helpers/app";
import { cookieFor, USER } from "../../helpers/auth";

const result = {
  mode: "rule_based" as const,
  recommendations: [],
  suggestions: [],
};

const body = {
  budgetMax: 20_000_000,
  usage: "CODING",
  priorities: [],
  workloads: [],
};

const service = { recommend: jest.fn().mockResolvedValue(result) };
const appWithService = () =>
  buildApp({ advisor: { service, identitySecret: "advisor-test-secret" } } as AppDeps);

beforeEach(() => jest.clearAllMocks());

describe("POST /api/v1/advisor/recommend", () => {
  it("uses a hashed guest requester key without exposing the IP", async () => {
    const res = await request(appWithService()).post("/api/v1/advisor/recommend").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: result });
    expect(service.recommend).toHaveBeenCalledWith(
      body,
      expect.objectContaining({ kind: "guest", key: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
    expect(service.recommend.mock.calls[0][1].key).not.toContain("127.0.0.1");
  });

  it("uses the authenticated user id as requester identity", async () => {
    const res = await request(appWithService())
      .post("/api/v1/advisor/recommend")
      .set("Cookie", cookieFor(USER))
      .send(body);
    expect(res.status).toBe(200);
    expect(service.recommend.mock.calls[0][1]).toEqual({ kind: "user", key: "1" });
  });

  it("rejects a malformed token before calling the service", async () => {
    const res = await request(appWithService())
      .post("/api/v1/advisor/recommend")
      .set("Cookie", "access_token=invalid")
      .send(body);
    expect(res.status).toBe(401);
    expect(service.recommend).not.toHaveBeenCalled();
  });

  it("validates the body before calling the service", async () => {
    const res = await request(appWithService())
      .post("/api/v1/advisor/recommend")
      .send({ ...body, usage: "UNKNOWN" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(service.recommend).not.toHaveBeenCalled();
  });
});
