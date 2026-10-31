import { withSocketTimeout } from "config/client";

describe("withSocketTimeout", () => {
  it("adds a query timeout to the database URL", () => {
    const url = new URL(
      withSocketTimeout("mysql://user:p%40ss@localhost:3306/shop?connection_limit=5"),
    );
    expect(url.searchParams.get("socket_timeout")).toBe("30");
    expect(url.searchParams.get("connection_limit")).toBe("5");
    expect(url.password).toBe("p%40ss");
    expect(url.pathname).toBe("/shop");
  });

  it("keeps a timeout set in the URL", () => {
    const url = new URL(
      withSocketTimeout("mysql://user:pass@localhost:3306/shop?socket_timeout=5"),
    );
    expect(url.searchParams.get("socket_timeout")).toBe("5");
  });
});
