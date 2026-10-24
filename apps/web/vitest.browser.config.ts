import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { internalDocumentationEnabled } from "./scripts/documentation-build.js";

export default defineConfig({
  plugins: [react({ compiler: true })],
  // Match the development server when component tests import route composition.
  // Actual product/internal artifacts are covered by the build isolation tests.
  define: {
    __ORION_INTERNAL_DOCS__: JSON.stringify(
      internalDocumentationEnabled("serve", process.env),
    ),
  },
  optimizeDeps: {
    include: [
      "@tanstack/react-query",
      "@tanstack/react-router",
      "react-dom/client",
    ],
  },
  test: {
    include: ["test/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright({
        launchOptions:
          process.platform === "win32" ? { channel: "msedge" } : {},
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});
