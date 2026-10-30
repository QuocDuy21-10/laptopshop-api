import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import importOrderByLength from "./eslint-rules/import-order-by-length.mjs";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "public", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: globals.node },
    plugins: { local: { rules: { "import-order-by-length": importOrderByLength } } },
    rules: {
      // warn so legacy files do not block `pnpm lint`; lint-staged `eslint --fix` sorts touched files
      "local/import-order-by-length": [
        "warn",
        {
          aliases: [
            "config",
            "middlewares",
            "models",
            "routes",
            "lib",
            "docs",
            "modules",
            "queues",
            "scripts",
          ],
        },
      ],
      "no-duplicate-imports": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", { fixStyle: "inline-type-imports" }],
      // legacy code uses `any` widely; warn, do not block
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/triple-slash-reference": "off", // app.ts loads the Express.User augmentation this way
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // jest.isolateModules needs require() to load a fresh module registry
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
