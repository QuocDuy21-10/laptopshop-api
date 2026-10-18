import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/tests/integration/"],
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false }] },
  moduleNameMapper: {
    "^(config|controllers|middlewares|models|routes|services|views|validation|lib|docs|modules)/(.*)$":
      "<rootDir>/src/$1/$2",
  },
  clearMocks: true,
};

export default config;
