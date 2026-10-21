jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));
jest.mock("modules/reviews/review-helpful.service", () => ({
  listMyHelpfulReviewIds: jest.fn(),
  markReviewHelpful: jest.fn(),
  unmarkReviewHelpful: jest.fn(),
}));

import request from "supertest";
import { buildApp } from "../../helpers/app";
import { cookieFor, USER } from "../../helpers/auth";
import {
  listMyHelpfulReviewIds,
  markReviewHelpful,
  unmarkReviewHelpful,
} from "modules/reviews/review-helpful.service";

const mockedList = jest.mocked(listMyHelpfulReviewIds);
const mockedMark = jest.mocked(markReviewHelpful);
const mockedUnmark = jest.mocked(unmarkReviewHelpful);

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue([2, 5]);
  mockedMark.mockResolvedValue({ reviewId: 2, helpfulCount: 4, helpful: true });
  mockedUnmark.mockResolvedValue({ reviewId: 2, helpfulCount: 3, helpful: false });
});

describe("review helpful routes", () => {
  it("requires authentication for batch state and mutations", async () => {
    expect((await request(buildApp()).get("/api/v1/reviews/helpful?reviewIds=2")).status).toBe(401);
    expect((await request(buildApp()).put("/api/v1/reviews/2/helpful")).status).toBe(401);
    expect((await request(buildApp()).delete("/api/v1/reviews/2/helpful")).status).toBe(401);
  });

  it("normalizes duplicate batch IDs and returns the viewer state", async () => {
    const res = await request(buildApp())
      .get("/api/v1/reviews/helpful?reviewIds=2,2,5")
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { reviewIds: [2, 5] } });
    expect(mockedList).toHaveBeenCalledWith(1, [2, 5]);
  });

  it("returns a stable count for idempotent helpful mutations", async () => {
    const put = await request(buildApp())
      .put("/api/v1/reviews/2/helpful")
      .set("Cookie", cookieFor(USER));
    const remove = await request(buildApp())
      .delete("/api/v1/reviews/2/helpful")
      .set("Cookie", cookieFor(USER));

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ data: { reviewId: 2, helpfulCount: 4, helpful: true } });
    expect(remove.status).toBe(200);
    expect(remove.body).toEqual({ data: { reviewId: 2, helpfulCount: 3, helpful: false } });
    expect(mockedMark).toHaveBeenCalledWith(1, 2);
    expect(mockedUnmark).toHaveBeenCalledWith(1, 2);
  });

  it("rejects malformed batch input before calling the service", async () => {
    const tooMany = Array.from({ length: 51 }, (_, index) => index + 1).join(",");
    const res = await request(buildApp())
      .get(`/api/v1/reviews/helpful?reviewIds=${tooMany}`)
      .set("Cookie", cookieFor(USER));

    expect(res.status).toBe(400);
    expect(mockedList).not.toHaveBeenCalled();
  });
});
