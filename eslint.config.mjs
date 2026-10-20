import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "**/dist/**",
      "apps/api/src/generated/**",
      // The Android TV player is a Gradle build; its outputs are not project JavaScript.
      "apps/player/**",
    ],
  },
  {
    files: ["**/*.{mjs,cjs,js,jsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        process: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      "apps/web/src/**/*.{ts,tsx}",
      "apps/mobile/src/**/*.{ts,tsx}",
      "apps/desktop/src/**/*.{ts,tsx}",
      "packages/sdk/src/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "Browser runtime and SDK cannot import Node.js built-ins.",
            },
            {
              group: [
                "@prisma/*",
                "prisma",
                "pg",
                "fastify",
                "@fastify/*",
                "pino",
                "@opentelemetry/sdk*",
                "@opentelemetry/exporter*",
                "@opentelemetry/instrumentation*",
              ],
              message:
                "Browser runtime and SDK cannot import server infrastructure libraries.",
            },
          ],
        },
      ],
    },
  },
);
