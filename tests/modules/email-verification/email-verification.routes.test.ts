jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import request from "supertest";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { buildApp } from "../../helpers/app";
import { USER, cookieFor } from "../../helpers/auth";

beforeEach(resetPrisma);

describe("email verification routes", () => {
  it("returns EMAIL_DELIVERY_UNAVAILABLE without an enabled provider", async () => {
    const response = await request(buildApp())
      .post("/api/v1/me/email-verification/request")
      .set("Cookie", cookieFor(USER));

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("EMAIL_DELIVERY_UNAVAILABLE");
    expect(prismaMock.emailVerificationChallenge.create).not.toHaveBeenCalled();
  });
});
