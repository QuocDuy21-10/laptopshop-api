jest.mock("@sentry/node", () => ({ init: jest.fn() }));

// isolateModules gives a fresh registry (and a fresh mock), so read the mock from inside it
const load = (dsn?: string) => {
  if (dsn) process.env.SENTRY_DSN = dsn;
  else delete process.env.SENTRY_DSN;
  let init!: jest.Mock;
  jest.isolateModules(() => {
    require("../src/instrument");
    init = require("@sentry/node").init;
  });
  delete process.env.SENTRY_DSN;
  return init;
};

describe("sentry instrumentation", () => {
  it("does nothing without SENTRY_DSN", () => {
    expect(load()).not.toHaveBeenCalled();
  });

  it("initialises without collecting PII when SENTRY_DSN is set", () => {
    const dsn = "https://abc@o1.ingest.sentry.io/1";
    expect(load(dsn)).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn,
        dataCollection: expect.objectContaining({
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
        }),
      }),
    );
  });
});
