import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false }] },
  moduleNameMapper: {
    "^(config|controllers|middlewares|models|routes|services|views|validation|lib|docs)/(.*)$":
      "<rootDir>/src/$1/$2",
  },
  clearMocks: true,
};

export default config;
