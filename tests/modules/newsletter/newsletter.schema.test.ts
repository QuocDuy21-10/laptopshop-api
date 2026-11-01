import {
  adminExportSubscribersQuery,
  adminListSubscribersQuery,
  subscribeBody,
  tokenBody,
} from "modules/newsletter/newsletter.schema";

describe("subscribeBody", () => {
  it("trims and lowercases the email", () => {
    expect(subscribeBody.parse({ email: "  A@B.Com " }).email).toBe("a@b.com");
  });

  it("rejects a malformed or oversized email", () => {
    expect(() => subscribeBody.parse({ email: "not-an-email" })).toThrow();
    expect(() => subscribeBody.parse({})).toThrow();
    expect(() => subscribeBody.parse({ email: `${"a".repeat(250)}@b.co` })).toThrow();
  });
});

describe("tokenBody", () => {
  it("requires a non-empty bounded token", () => {
    expect(tokenBody.parse({ token: " abc " }).token).toBe("abc");
    expect(() => tokenBody.parse({ token: "" })).toThrow();
    expect(() => tokenBody.parse({ token: "x".repeat(201) })).toThrow();
    expect(() => tokenBody.parse({})).toThrow();
  });
});

describe("admin queries", () => {
  it("lists with optional status and search and defaults paging", () => {
    expect(adminListSubscribersQuery.parse({})).toMatchObject({ page: 1, pageSize: 10 });
    expect(adminListSubscribersQuery.parse({ status: "PENDING", q: " abc " })).toMatchObject({
      status: "PENDING",
      q: "abc",
    });
    expect(() => adminListSubscribersQuery.parse({ status: "DELETED" })).toThrow();
  });

  it("exports confirmed subscribers by default", () => {
    expect(adminExportSubscribersQuery.parse({}).status).toBe("CONFIRMED");
    expect(adminExportSubscribersQuery.parse({ status: "UNSUBSCRIBED" }).status).toBe(
      "UNSUBSCRIBED",
    );
  });
});
