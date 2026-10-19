import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import pg from "pg";
import {
  freePort,
  startApi,
  startDatabase,
  startWeb,
  stopAll,
  watchService,
  type Stoppable,
} from "../stack.ts";

// Disposable stack for identity journeys: migrated PostgreSQL, the API's
// local Keycloak/Mailpit pair (started through its CLI so the realm contract
// has one source), the emitted API with human sessions, and the Vite app.
const apiRoot = resolve(import.meta.dirname, "../../../../api");

type LocalIdentity = Stoppable & {
  issuer: string;
  audience: string;
  jwksUrl: string;
  webClientId: string;
  webClientSecret: string;
  provisionerClientId: string;
  provisionerClientSecret: string;
  mailUrl: string;
  mailSmtpHost: string;
  mailSmtpPort: number;
};

async function startLocalIdentity(options: {
  publicOrigin: string;
  apiPort: number;
  users: readonly { email: string; password: string }[];
}): Promise<LocalIdentity> {
  const child = spawn(
    process.execPath,
    [
      resolve(apiRoot, "node_modules/tsx/dist/cli.mjs"),
      resolve(apiRoot, "scripts/local-identity.ts"),
      "--public-origin",
      options.publicOrigin,
      "--api-port",
      String(options.apiPort),
      "--users",
      JSON.stringify(options.users),
    ],
    { cwd: apiRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const service = watchService(
    "Local identity",
    child,
    options.users.map((user) => user.password),
  );
  const stop = () =>
    new Promise<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      child.once("exit", () => done());
      child.kill("SIGTERM");
    });
  const description = await new Promise<string>((resolveLine, reject) => {
    const lines = createInterface({ input: child.stdout });
    lines.once("line", (line) => {
      lines.close();
      resolveLine(line);
    });
    service.onFailure(reject);
    setTimeout(
      () => reject(new Error("Local identity did not start")),
      240_000,
    );
  }).catch(async (error: unknown) => {
    await stop();
    throw error;
  });
  return { ...(JSON.parse(description) as Omit<LocalIdentity, "stop">), stop };
}

export type IdentityStack = Stoppable & {
  webUrl: string;
  apiUrl: string;
  mailUrl: string;
  user: { email: string; password: string };
  member: { email: string; password: string };
  /** A third person who joins only through an invitation. */
  guest: { email: string; password: string };
  /** Superuser fixture arrangement only, never an application credential. */
  sql: pg.Client;
};

export async function startIdentityStack(): Promise<IdentityStack> {
  const user = {
    email: `operator-${randomBytes(4).toString("hex")}@example.test`,
    password: `Synthetic-${randomBytes(9).toString("base64url")}`,
  };
  const resources: (Stoppable | undefined)[] = [];
  const member = {
    email: `member-${randomBytes(4).toString("hex")}@example.test`,
    password: `Synthetic-${randomBytes(9).toString("base64url")}`,
  };
  const guest = {
    email: `guest-${randomBytes(4).toString("hex")}@example.test`,
    password: `Synthetic-${randomBytes(9).toString("base64url")}`,
  };
  try {
    const database = await startDatabase();
    resources.push(database);
    const sql = new pg.Client({ connectionString: database.migrationUrl });
    await sql.connect();
    resources.unshift({ stop: () => sql.end() });
    const webPort = await freePort();
    const apiPort = await freePort();
    const publicOrigin = `http://127.0.0.1:${webPort}`;
    const identity = await startLocalIdentity({
      publicOrigin,
      apiPort,
      users: [user, member, guest],
    });
    resources.unshift(identity);
    const sessionKeys = `e2e:${randomBytes(32).toString("base64url")}`;
    const mailKeys = `e2e:${randomBytes(32).toString("base64url")}`;
    const deviceCodeKeys = `e2e:${randomBytes(32).toString("base64url")}`;
    const secrets = [
      identity.webClientSecret,
      identity.provisionerClientSecret,
      sessionKeys,
      mailKeys,
      deviceCodeKeys,
      user.password,
      member.password,
      guest.password,
    ];
    const api = await startApi({
      port: apiPort,
      secrets,
      env: {
        ORION_DATABASE_URL: database.runtimeUrl,
        ORION_TOKEN_ISSUER: identity.issuer,
        ORION_TOKEN_AUDIENCE: identity.audience,
        ORION_TOKEN_JWKS_URL: identity.jwksUrl,
        TELUNI_PUBLIC_ORIGIN: publicOrigin,
        TELUNI_OIDC_CLIENT_ID: identity.webClientId,
        TELUNI_OIDC_CLIENT_SECRET: identity.webClientSecret,
        TELUNI_IDENTITY_PROVISIONER_CLIENT_ID: identity.provisionerClientId,
        TELUNI_IDENTITY_PROVISIONER_CLIENT_SECRET:
          identity.provisionerClientSecret,
        TELUNI_SESSION_KEYS: sessionKeys,
        TELUNI_MAIL_SMTP_HOST: identity.mailSmtpHost,
        TELUNI_MAIL_SMTP_PORT: String(identity.mailSmtpPort),
        TELUNI_MAIL_SMTP_SECURITY: "none",
        TELUNI_MAIL_FROM: "no-reply@teluni.test",
        TELUNI_MAIL_KEYS: mailKeys,
        TELUNI_DEVICE_CODE_KEYS: deviceCodeKeys,
      },
    });
    resources.unshift(api);
    const web = await startWeb({ apiUrl: api.url, port: webPort, secrets });
    resources.unshift(web);
    return {
      webUrl: web.url,
      apiUrl: api.url,
      mailUrl: identity.mailUrl,
      user,
      member,
      guest,
      sql,
      stop: () => stopAll(resources),
    };
  } catch (error) {
    await stopAll(resources);
    throw error;
  }
}
