import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/tests/integration/"],
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false }] },
  moduleNameMapper: {
    "^(config|middlewares|models|routes|lib|docs|modules)/(.*)$":
      "<rootDir>/src/$1/$2",
  },
  clearMocks: true,
};

export default config;
