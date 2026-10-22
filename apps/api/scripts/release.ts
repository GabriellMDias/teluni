import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { provisionTeluniRealm } from "./identity-realm.js";
import { keycloakAdmin } from "./keycloak.js";
import { applyRuntimeGrants } from "./runtime-grants.js";

// Release steps of the pilot deployment (docs/project/deployment-design.md),
// run by the release image of infra/pilot. Each step is idempotent.
//   database  apply reviewed migrations with the owner role, then give the
//             existing runtime role its module grants
//   realm     create or update the teluni realm through the bootstrap
//             administrator
//   end-sessions  end every Keycloak session of the realm, after a restore
// Settings come from the environment; secrets are never printed.

const run = promisify(execFile);
const appRoot = resolve(import.meta.dirname, "..");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Release setting ${name} is missing.`);
  return value;
}

async function database(): Promise<void> {
  const url = required("ORION_MIGRATION_DATABASE_URL");
  await run(
    process.execPath,
    [
      resolve(appRoot, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    { cwd: appRoot, env: process.env, timeout: 300_000 },
  );
  const owner = new pg.Client({ connectionString: url });
  await owner.connect();
  try {
    await applyRuntimeGrants(owner);
  } finally {
    await owner.end();
  }
  console.log("release_database_ready");
}

async function realm(): Promise<void> {
  const publicOrigin = required("TELUNI_PUBLIC_ORIGIN");
  await provisionTeluniRealm(await administrator(), {
    realm: "teluni",
    publicOrigin,
    backchannelLogoutUrl: `${publicOrigin}/api/auth/backchannel-logout`,
    apiAudience: required("ORION_TOKEN_AUDIENCE"),
    webClientSecret: required("TELUNI_OIDC_CLIENT_SECRET"),
    provisionerClientSecret: required(
      "TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET",
    ),
  });
  console.log("release_realm_ready");
}

/** The bootstrap administrator, once Keycloak has finished starting. */
async function administrator() {
  const baseUrl = required("TELUNI_KEYCLOAK_ADMIN_URL");
  // Keycloak answers 503 while it bootstraps its database after a start.
  for (let attempt = 1; ; attempt += 1) {
    const status = await fetch(`${baseUrl}/realms/master`).then(
      (response) => response.status,
      () => 0,
    );
    if (status === 200) break;
    if (attempt === 60)
      throw new Error(`Keycloak is not ready (last status ${status}).`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return keycloakAdmin(baseUrl, {
    username: required("TELUNI_KEYCLOAK_ADMIN_USERNAME"),
    password: required("TELUNI_KEYCLOAK_ADMIN_PASSWORD"),
  });
}

async function endSessions(): Promise<void> {
  const response = await (
    await administrator()
  ).request("POST", "/realms/teluni/logout-all");
  if (!response.ok)
    throw new Error(`Keycloak logout-all failed with HTTP ${response.status}`);
  console.log("release_sessions_ended");
}

const steps: Record<string, () => Promise<void>> = {
  database,
  realm,
  "end-sessions": endSessions,
};
const step = steps[process.argv[2] ?? ""];
if (!step) {
  console.error(`Usage: release.ts ${Object.keys(steps).join(" | ")}`);
  process.exit(2);
}
await step();
