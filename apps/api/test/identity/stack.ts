import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import pino from "pino";
import pg from "pg";
import { TestContainers } from "testcontainers";
import { createApp } from "../../src/app.js";
import { createAccessTokenVerifier } from "../../src/authentication.js";
import { createDatabase, type Database } from "../../src/database.js";
import { createIdentityModule } from "../../src/features/identity/module.js";
import type { HumanSessionPort } from "../../src/features/identity/public.js";
import {
  activateModules,
  type HumanIdentitySettings,
} from "../../src/module.js";
import { provisionTeluniRealm } from "../../scripts/identity-realm.js";
import { withKeycloak, type KeycloakAdmin } from "../../scripts/keycloak.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";
import {
  CookieJar,
  createSyntheticUser,
  signInAtProvider,
} from "./keycloak-browser.js";

export const realm = "teluni";
export const audience = "teluni-api";

export type IdentityStack = Readonly<{
  apiUrl: string;
  publicOrigin: string;
  admin: KeycloakAdmin;
  issuer: string;
  sessions: HumanSessionPort;
  /** Superuser access for arranging and inspecting state. */
  sql: pg.Client;
  database: Database;
}>;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No free port")),
      );
    });
  });
}

/**
 * Runs `work` against a migrated PostgreSQL, a provisioned disposable
 * Keycloak and the API with the identity module listening on loopback.
 * Keycloak reaches the API's back-channel logout route through the
 * Testcontainers host-port forwarder.
 */
export async function withIdentityStack<T>(
  work: (stack: IdentityStack) => Promise<T>,
): Promise<T> {
  return withMigratedDatabase(async (runtimeUrl, migrationUrl) => {
    const port = await freePort();
    await TestContainers.exposeHostPorts(port);
    return withKeycloak(async (admin) => {
      const publicOrigin = `http://127.0.0.1:${port}`;
      const webClientSecret = randomBytes(24).toString("base64url");
      const provisionerClientSecret = randomBytes(24).toString("base64url");
      await provisionTeluniRealm(admin, {
        realm,
        publicOrigin,
        backchannelLogoutUrl: `http://host.testcontainers.internal:${port}/auth/backchannel-logout`,
        apiAudience: audience,
        webClientSecret,
        provisionerClientSecret,
      });
      const issuer = `${admin.baseUrl}/realms/${realm}`;
      const settings: HumanIdentitySettings = {
        environment: "test",
        issuer,
        publicOrigin,
        clientId: "teluni-web",
        clientSecret: webClientSecret,
        provisionerClientId: "teluni-provisioner",
        provisionerClientSecret,
        sessionKeys: [{ id: "k1", key: randomBytes(32) }],
      };
      const database = createDatabase(runtimeUrl);
      const sql = new pg.Client({ connectionString: migrationUrl });
      await sql.connect();
      const identity = createIdentityModule({
        rateLimit: { max: 10_000, timeWindow: 60_000 },
      });
      const modules = activateModules(
        [identity.module],
        {
          database,
          verifier: createAccessTokenVerifier({
            issuer,
            audience,
            jwksUrl: `${issuer}/protocol/openid-connect/certs`,
          }),
          humanIdentity: settings,
        },
        "test",
      );
      const { app, lifecycle } = createApp(
        pino({ level: "silent" }),
        undefined,
        {
          modules,
        },
      );
      await app.listen({ host: "127.0.0.1", port });
      lifecycle.markReady();
      try {
        return await work({
          apiUrl: publicOrigin,
          publicOrigin,
          admin,
          issuer,
          sessions: identity.sessions,
          sql,
          database,
        });
      } finally {
        await app.close();
        await sql.end();
        await database.$disconnect();
      }
    });
  });
}

/** A scripted browser holding the panel's cookies for one person. */
export class PanelBrowser {
  readonly api = new CookieJar();
  readonly provider = new CookieJar();
  readonly #stack: IdentityStack;
  csrfToken: string | undefined;

  constructor(stack: IdentityStack) {
    this.#stack = stack;
  }

  /** The panel path behind the `/api` proxy maps directly onto the API. */
  apiUrl(path: string): string {
    return `${this.#stack.apiUrl}${path.replace(/^\/api(?=\/)/, "")}`;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("cookie", this.api.header());
    const response = await fetch(this.apiUrl(path), {
      ...init,
      headers,
      redirect: "manual",
    });
    this.api.store(response);
    return response;
  }

  /** Unsafe request from the panel origin with the session CSRF token. */
  async mutate(path: string, method = "POST"): Promise<Response> {
    return this.request(path, {
      method,
      headers: {
        origin: this.#stack.publicOrigin,
        ...(this.csrfToken ? { "x-csrf-token": this.csrfToken } : {}),
      },
    });
  }

  /** Starts a login and returns the provider's redirect back to the callback. */
  async beginLogin(
    credentials: { username: string; password: string },
    returnTo = "/",
  ): Promise<URL> {
    const start = await this.request(
      `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
    if (start.status !== 303)
      throw new Error(`Login start returned ${start.status}`);
    return signInAtProvider(
      start.headers.get("location")!,
      credentials,
      this.provider,
    );
  }

  async finishLogin(callback: URL): Promise<Response> {
    return this.request(`${callback.pathname}${callback.search}`);
  }

  async login(
    credentials: { username: string; password: string },
    returnTo = "/",
  ): Promise<Response> {
    const finished = await this.finishLogin(
      await this.beginLogin(credentials, returnTo),
    );
    const summary = await this.request("/auth/session");
    if (summary.status === 200)
      this.csrfToken = (
        (await summary.json()) as { csrfToken: string }
      ).csrfToken;
    return finished;
  }
}

export async function syntheticPerson(stack: IdentityStack) {
  const email = `person-${randomBytes(6).toString("hex")}@example.test`;
  const password = `Synthetic-${randomBytes(9).toString("base64url")}`;
  const userId = await createSyntheticUser(stack.admin, realm, {
    email,
    password,
  });
  return {
    email,
    password,
    userId,
    credentials: { username: email, password },
  };
}
