import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests/redis-integration"],
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false }] },
  moduleNameMapper: {
    "^(config|middlewares|models|routes|lib|docs|modules|queues|scripts)/(.*)$":
      "<rootDir>/src/$1/$2",
  },
  testTimeout: 30_000,
};

export default config;
