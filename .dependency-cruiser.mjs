const error = (name, comment, from, to) => ({
  name,
  comment,
  severity: "error",
  from,
  to,
});

export default {
  forbidden: [
    error(
      "no-circular-dependencies",
      "Circular dependencies violate architectural boundaries.",
      {},
      { circular: true },
    ),
    error(
      "no-unresolved-dependencies",
      "Imports must resolve to declared or local modules.",
      {},
      { couldNotResolve: true },
    ),
    error(
      "no-cross-application-imports",
      "Applications communicate through contracts, not another application's implementation.",
      { path: "^apps/([^/]+)/.+" },
      { path: "^apps/[^/]+/.+", pathNot: "^apps/$1/.+" },
    ),
    error(
      "no-package-to-application",
      "Shared packages must not depend on applications.",
      { path: "^packages/" },
      { path: "^apps/" },
    ),
    error(
      "no-runtime-to-tooling",
      "Application and package runtime code must not import repository tooling.",
      { path: "^(apps|packages)/" },
      { path: "^tooling/" },
    ),
    error(
      "no-runtime-to-infra",
      "Runtime code must not import infrastructure definitions.",
      { path: "^(apps|packages)/" },
      { path: "^infra/" },
    ),
    error(
      "no-client-to-server",
      "Client code must not import server-only capabilities.",
      { path: "^apps/(web|mobile|desktop)/" },
      { path: "^(apps/api|packages/database)/" },
    ),
    error(
      "no-client-node-builtins",
      "Browser runtime and its SDK must not depend on Node.js built-ins.",
      { path: "^apps/(web|mobile|desktop)/src/|^packages/sdk/src/" },
      { dependencyTypes: ["core"] },
    ),
    error(
      "no-shared-api-to-module",
      "Shared API runtime code must not depend on a feature module; only the composition file apps/api/src/modules.ts composes modules.",
      {
        path: "^apps/api/src/",
        pathNot: "^apps/api/src/(features/|modules\\.ts$)",
      },
      { path: "^apps/api/src/features/" },
    ),
    error(
      "no-feature-internals",
      "A feature module uses another module only through that module's public.ts capability surface.",
      { path: "^apps/api/src/features/([^/]+)/" },
      {
        path: "^apps/api/src/features/",
        pathNot: [
          "^apps/api/src/features/$1/",
          "^apps/api/src/features/[^/]+/public\\.ts$",
        ],
      },
    ),
    error(
      "no-domain-to-infrastructure",
      "Domain code must stay independent of HTTP, persistence, and infrastructure adapters.",
      { path: "^(apps|packages)/.+/domain(/|\\.[cm]?[jt]sx?$)" },
      {
        path: "(^|/)(infrastructure|transport|persistence)/|^packages/database/|/(prisma-repository|routes|authentication|contracts|config|main|logging|telemetry)\\.[cm]?[jt]sx?$",
      },
    ),
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Bundler chunks are derived output; inspect their canonical source graph.
    exclude:
      "(^|/)(node_modules|dist|coverage|test-results|playwright-report|generated)/",
    tsConfig: { fileName: "tsconfig.json" },
  },
};
