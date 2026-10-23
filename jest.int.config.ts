import type { Config } from "jest";

// kept self-contained: jest loads this file without TypeScript module resolution
const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests/integration"],
  setupFiles: ["<rootDir>/tests/integration/setup-env.ts"],
  globalSetup: "<rootDir>/tests/integration/global-setup.ts",
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false }] },
  moduleNameMapper: {
    "^(config|middlewares|models|routes|lib|docs|modules|queues)/(.*)$": "<rootDir>/src/$1/$2",
  },
  testTimeout: 30_000,
};

export default config;
