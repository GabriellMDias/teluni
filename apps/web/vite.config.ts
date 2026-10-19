import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFoundationVersion } from "./scripts/foundation-version.js";
import { escapeHtml, readProjectIdentity } from "./scripts/project-identity.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const identity = readProjectIdentity(repositoryRoot);

export default defineConfig({
  plugins: [
    react({ compiler: true }),
    {
      name: "project-identity",
      transformIndexHtml: (html) =>
        html.replaceAll("%PROJECT_NAME%", escapeHtml(identity.name)),
    },
  ],
  define: {
    __ORION_FOUNDATION_VERSION__: JSON.stringify(
      readFoundationVersion(repositoryRoot),
    ),
    __PROJECT_NAME__: JSON.stringify(identity.name),
  },
  build: { assetsInlineLimit: 0 },
  server: {
    // Transform the application entry graph at startup so the first page a
    // fresh dev server serves is not slowed by on-demand compilation.
    warmup: { clientFiles: ["./src/main.tsx"] },
    proxy: {
      "/api": {
        target: process.env.ORION_WEB_API_TARGET ?? "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      ...(process.env.ORION_WEB_LOCAL_IDENTITY_TARGET
        ? {
            "/__orion_local_identity": {
              target: process.env.ORION_WEB_LOCAL_IDENTITY_TARGET,
              changeOrigin: true,
              rewrite: (path: string) =>
                path.replace(/^\/__orion_local_identity/, "/local-identity"),
            },
          }
        : {}),
    },
  },
});
