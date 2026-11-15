import { execFile } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import {
  provisionerClientId,
  provisionTeluniRealm,
  webClientId,
} from "./identity-realm.js";
import {
  keycloakAdmin,
  keycloakImage,
  mailpitImage,
  teluniThemeFiles,
} from "./keycloak.js";
import { applyRuntimeGrants } from "./runtime-grants.js";

// Persistent local development services: PostgreSQL, Keycloak and Mailpit as
// named Docker containers with named volumes, published on loopback only.
//
//   up     create or start them, apply migrations and runtime grants,
//          provision the teluni realm and a synthetic developer account, and
//          write the root .env.local that `pnpm -C apps/api dev` loads
//   down   stop them and keep their data
//   reset  remove them and their data
//
// Development only: every credential is generated for this machine and kept
// in the ignored root files .env.local and .env.dev-services. Never point
// this script at a shared or production system.

const run = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const appRoot = resolve(import.meta.dirname, "..");
const envFile = resolve(repositoryRoot, ".env.local");
const stateFile = resolve(repositoryRoot, ".env.dev-services");
// Media objects live on the host so FFmpeg in the API process reads them.
const mediaDirectory = resolve(repositoryRoot, ".dev-media");

const postgresImage = "postgres:16";
const realm = "teluni";
const audience = "teluni-api";
const ports = {
  postgres: 55433,
  keycloak: 8180,
  keycloakManagement: 9180,
  smtp: 1025,
  mailInbox: 8025,
  api: 3000,
  web: 5173,
} as const;
const network = "teluni-dev";
const containers = {
  postgres: "teluni-dev-postgres",
  keycloak: "teluni-dev-keycloak",
  mailpit: "teluni-dev-mailpit",
} as const;
const volumes = {
  postgres: "teluni-dev-postgres",
  keycloak: "teluni-dev-keycloak",
} as const;
const publicOrigin = `http://127.0.0.1:${ports.web}`;
const keycloakUrl = `http://localhost:${ports.keycloak}`;
const developer = {
  email: "dev@teluni.test",
  firstName: "Dev",
  lastName: "Teluni",
};

type State = Record<
  | "POSTGRES_PASSWORD"
  | "RUNTIME_PASSWORD"
  | "KEYCLOAK_ADMIN_PASSWORD"
  | "WEB_CLIENT_SECRET"
  | "PROVISIONER_CLIENT_SECRET"
  | "SESSION_KEY"
  | "MAIL_KEY"
  | "DEVICE_CODE_KEY"
  | "SYNC_SIGNING_KEY"
  | "DEVELOPER_PASSWORD",
  string
>;

const secret = (bytes = 24) => randomBytes(bytes).toString("base64url");

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { maxBuffer: 1 << 20 });
  return stdout.trim();
}

async function exists(kind: "container" | "network" | "volume", name: string) {
  try {
    await docker(kind, "inspect", name);
    return true;
  } catch {
    return false;
  }
}

async function readState(): Promise<State> {
  let current: Partial<State> = {};
  try {
    for (const line of (await readFile(stateFile, "utf8")).split("\n")) {
      const match = /^TELUNI_DEV_([A-Z_]+)=(.+)$/.exec(line.trim());
      if (match) current = { ...current, [match[1]]: match[2] };
    }
  } catch {
    /* The first `up` creates the state. */
  }
  const state: State = {
    POSTGRES_PASSWORD: current.POSTGRES_PASSWORD ?? secret(),
    RUNTIME_PASSWORD: current.RUNTIME_PASSWORD ?? secret(),
    KEYCLOAK_ADMIN_PASSWORD: current.KEYCLOAK_ADMIN_PASSWORD ?? secret(18),
    WEB_CLIENT_SECRET: current.WEB_CLIENT_SECRET ?? secret(),
    PROVISIONER_CLIENT_SECRET: current.PROVISIONER_CLIENT_SECRET ?? secret(),
    SESSION_KEY: current.SESSION_KEY ?? randomBytes(32).toString("base64url"),
    MAIL_KEY: current.MAIL_KEY ?? randomBytes(32).toString("base64url"),
    DEVICE_CODE_KEY:
      current.DEVICE_CODE_KEY ?? randomBytes(32).toString("base64url"),
    SYNC_SIGNING_KEY:
      current.SYNC_SIGNING_KEY ??
      generateKeyPairSync("ec", { namedCurve: "P-256" })
        .privateKey.export({ format: "der", type: "pkcs8" })
        .toString("base64url"),
    DEVELOPER_PASSWORD: current.DEVELOPER_PASSWORD ?? `Teluni-dev-${secret(9)}`,
  };
  await writeFile(
    stateFile,
    [
      "# Local development service credentials written by",
      "# `pnpm -C apps/api dev:services up`. Ignored by Git; machine-local only.",
      ...Object.entries(state).map(
        ([key, value]) => `TELUNI_DEV_${key}=${value}`,
      ),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return state;
}

async function startContainer(name: string, args: string[]): Promise<void> {
  if (await exists("container", name)) {
    const running = await docker("inspect", "-f", "{{.State.Running}}", name);
    if (running !== "true") await docker("start", name);
    return;
  }
  await docker("run", "-d", "--name", name, "--network", network, ...args);
}

async function waitFor(what: string, check: () => Promise<boolean>) {
  const deadline = Date.now() + 240_000;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* Still starting. */
    }
    if (Date.now() > deadline) throw new Error(`${what} did not become ready`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
}

async function up(): Promise<void> {
  const state = await readState();
  if (!(await exists("network", network)))
    await docker("network", "create", network);
  await startContainer(containers.postgres, [
    "-p",
    `127.0.0.1:${ports.postgres}:5432`,
    "-e",
    "POSTGRES_USER=postgres",
    "-e",
    `POSTGRES_PASSWORD=${state.POSTGRES_PASSWORD}`,
    "-e",
    "POSTGRES_DB=teluni",
    "-v",
    `${volumes.postgres}:/var/lib/postgresql/data`,
    postgresImage,
  ]);
  await startContainer(containers.mailpit, [
    "-p",
    `127.0.0.1:${ports.smtp}:1025`,
    "-p",
    `127.0.0.1:${ports.mailInbox}:8025`,
    mailpitImage,
  ]);
  await startContainer(containers.keycloak, [
    "-p",
    `127.0.0.1:${ports.keycloak}:8080`,
    "-p",
    `127.0.0.1:${ports.keycloakManagement}:9000`,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-e",
    "KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap-admin",
    "-e",
    `KC_BOOTSTRAP_ADMIN_PASSWORD=${state.KEYCLOAK_ADMIN_PASSWORD}`,
    "-e",
    "KC_HEALTH_ENABLED=true",
    "-v",
    `${volumes.keycloak}:/opt/keycloak/data`,
    ...teluniThemeFiles().flatMap(({ source, target }) => [
      "-v",
      `${source}:${target}:ro`,
    ]),
    keycloakImage,
    "start-dev",
  ]);

  const migrationUrl = `postgresql://postgres:${encodeURIComponent(state.POSTGRES_PASSWORD)}@127.0.0.1:${ports.postgres}/teluni`;
  await waitFor("PostgreSQL", async () => {
    const client = new pg.Client({ connectionString: migrationUrl });
    await client.connect();
    await client.end();
    return true;
  });
  await run(
    process.execPath,
    [
      resolve(appRoot, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    {
      cwd: appRoot,
      env: { ...process.env, ORION_MIGRATION_DATABASE_URL: migrationUrl },
      timeout: 120_000,
    },
  );
  const admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'orion_runtime'",
    );
    const password = state.RUNTIME_PASSWORD.replaceAll("'", "''");
    await admin.query(
      rows.length === 0
        ? `CREATE ROLE orion_runtime LOGIN PASSWORD '${password}'`
        : `ALTER ROLE orion_runtime LOGIN PASSWORD '${password}'`,
    );
    await applyRuntimeGrants(admin);
  } finally {
    await admin.end();
  }

  await waitFor(
    "Mailpit",
    async () => (await fetch(`http://127.0.0.1:${ports.mailInbox}/readyz`)).ok,
  );
  await waitFor(
    "Keycloak",
    async () =>
      (await fetch(`http://127.0.0.1:${ports.keycloakManagement}/health/ready`))
        .ok,
  );
  const keycloak = keycloakAdmin(keycloakUrl, {
    username: "bootstrap-admin",
    password: state.KEYCLOAK_ADMIN_PASSWORD,
  });
  await provisionTeluniRealm(keycloak, {
    realm,
    publicOrigin,
    // Keycloak reaches the host through Docker's gateway. The API listens on
    // loopback by default, so back-channel logout only works when it listens
    // on an address the gateway can reach; the 30-second revalidation still
    // ends provider-side sessions.
    backchannelLogoutUrl: `http://host.docker.internal:${ports.api}/auth/backchannel-logout`,
    apiAudience: audience,
    webClientSecret: state.WEB_CLIENT_SECRET,
    provisionerClientSecret: state.PROVISIONER_CLIENT_SECRET,
    smtp: {
      host: containers.mailpit,
      port: 1025,
      from: "no-reply@teluni.test",
    },
  });
  const found = await keycloak.request(
    "GET",
    `/realms/${realm}/users?email=${encodeURIComponent(developer.email)}&exact=true`,
  );
  if (((await found.json()) as unknown[]).length === 0) {
    const created = await keycloak.request("POST", `/realms/${realm}/users`, {
      username: developer.email,
      email: developer.email,
      emailVerified: true,
      enabled: true,
      firstName: developer.firstName,
      lastName: developer.lastName,
      credentials: [
        { type: "password", value: state.DEVELOPER_PASSWORD, temporary: false },
      ],
    });
    if (created.status !== 201)
      throw new Error(`Developer account creation failed (${created.status})`);
  }

  const issuer = `${keycloakUrl}/realms/${realm}`;
  const runtimeUrl = `postgresql://orion_runtime:${encodeURIComponent(state.RUNTIME_PASSWORD)}@127.0.0.1:${ports.postgres}/teluni`;
  await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
  try {
    await copyFile(envFile, `${envFile}.before-dev-services`);
  } catch {
    /* No previous file. */
  }
  await writeFile(
    envFile,
    [
      "# Local development configuration written by `pnpm -C apps/api dev:services up`.",
      "# Ignored by Git; machine-local synthetic credentials only. Rerun the command",
      "# to restore it; see docs/setup.md#persistent-local-environment.",
      "ORION_ENV=development",
      `ORION_API_HOST=127.0.0.1`,
      `ORION_API_PORT=${ports.api}`,
      "ORION_LOG_LEVEL=info",
      `ORION_DATABASE_URL=${runtimeUrl}`,
      `ORION_TOKEN_ISSUER=${issuer}`,
      `ORION_TOKEN_AUDIENCE=${audience}`,
      `ORION_TOKEN_JWKS_URL=${issuer}/protocol/openid-connect/certs`,
      `TELUNI_PUBLIC_ORIGIN=${publicOrigin}`,
      `TELUNI_OIDC_CLIENT_ID=${webClientId}`,
      `TELUNI_OIDC_CLIENT_SECRET=${state.WEB_CLIENT_SECRET}`,
      `TELUNI_IDENTITY_PROVISIONER_CLIENT_ID=${provisionerClientId}`,
      `TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET=${state.PROVISIONER_CLIENT_SECRET}`,
      `TELUNI_SESSION_KEYS=dev:${state.SESSION_KEY}`,
      "TELUNI_MAIL_SMTP_HOST=127.0.0.1",
      `TELUNI_MAIL_SMTP_PORT=${ports.smtp}`,
      "TELUNI_MAIL_SMTP_SECURITY=none",
      "TELUNI_MAIL_FROM=no-reply@teluni.test",
      `TELUNI_MAIL_KEYS=dev:${state.MAIL_KEY}`,
      `TELUNI_DEVICE_CODE_KEYS=dev:${state.DEVICE_CODE_KEY}`,
      `TELUNI_SYNC_SIGNING_KEYS=dev:${state.SYNC_SIGNING_KEY}`,
      `TELUNI_MEDIA_STORAGE_PATH=${mediaDirectory}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  process.stdout.write(
    [
      "",
      "Teluni development services are running (data persists across restarts).",
      `  PostgreSQL:     127.0.0.1:${ports.postgres} (database teluni)`,
      `  Keycloak:       ${keycloakUrl} (admin console: ${keycloakUrl}/admin, user bootstrap-admin)`,
      `  Mail inbox:     http://127.0.0.1:${ports.mailInbox}`,
      `  Developer:      ${developer.email} (password in .env.dev-services)`,
      "  Wrote .env.local for the API. In two terminals run:",
      "    pnpm -C apps/api dev",
      "    pnpm -C apps/web dev",
      `  then open ${publicOrigin}`,
      "",
    ].join("\n"),
  );
}

async function down(): Promise<void> {
  for (const name of Object.values(containers))
    if (await exists("container", name)) await docker("stop", name);
  process.stdout.write("Teluni development services stopped; data kept.\n");
}

async function reset(): Promise<void> {
  for (const name of Object.values(containers))
    if (await exists("container", name)) await docker("rm", "-f", name);
  for (const name of Object.values(volumes))
    if (await exists("volume", name)) await docker("volume", "rm", name);
  if (await exists("network", network)) await docker("network", "rm", network);
  await rm(mediaDirectory, { recursive: true, force: true });
  process.stdout.write(
    "Teluni development services and their data were removed. The next `up` starts empty.\n",
  );
}

const command = process.argv[2] ?? "up";
const commands: Record<string, () => Promise<void>> = { up, down, reset };
const action = commands[command];
if (!action) {
  process.stderr.write("Usage: dev-services [up|down|reset]\n");
  process.exitCode = 2;
} else {
  await action();
}
