jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));

import request from "supertest";
import { buildApp } from "../helpers/app";

describe("/api/v1", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(buildApp()).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects unsafe requests from foreign origins", async () => {
    const res = await request(buildApp())
      .post("/api/v1/nope")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows credentialed CORS from the frontend origin", async () => {
    const res = await request(buildApp())
      .options("/api/v1/nope")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
