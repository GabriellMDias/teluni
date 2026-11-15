import { randomBytes } from "node:crypto";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createDatabase, type Database } from "../../src/database.js";
import { createIdentityModule } from "../../src/features/identity/module.js";
import type { IdentityProvider } from "../../src/features/identity/provider.js";
import { activateModules } from "../../src/module.js";
import { withMigratedDatabase } from "../../scripts/migrated-database.js";
import { CookieJar } from "./keycloak-browser.js";

// A provider that answers a reauthentication request with an older
// authentication must not produce a session that counts as recent.
let release: () => void;
let stopped: Promise<void>;
let apiUrl: string;
let requested: { maxAgeSeconds?: number; action?: string } | undefined;

const provider: IdentityProvider = {
  newChallenge: () =>
    Promise.resolve({
      state: "state-value",
      nonce: "nonce-value",
      codeVerifier: "verifier",
      codeChallenge: "challenge",
    }),
  authorizationUrl: (_challenge, request) => {
    requested = request;
    return Promise.resolve(new URL("https://provider.example.test/authorize"));
  },
  completeLogin: () =>
    Promise.resolve({
      tokens: {
        accessToken: "unused",
        refreshToken: "unused",
        idToken: null,
        expiresInSeconds: 300,
      },
      claims: {
        issuer: "https://provider.example.test/realms/teluni",
        subject: "subject",
        emailVerified: true,
        providerSessionId: null,
        assuranceLevel: "teluni-aal1",
        authenticatedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    }),
  refresh: () => Promise.reject(new Error("unexpected")),
  isActive: () => Promise.reject(new Error("unexpected")),
  endSession: () => Promise.resolve(),
  endAllSessions: () => Promise.resolve(),
  ensurePrincipalAttribute: () => Promise.reject(new Error("unexpected")),
  otpCredentials: () => Promise.reject(new Error("unexpected")),
  verifyLogoutToken: () => Promise.reject(new Error("unexpected")),
};

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  stopped = withMigratedDatabase(async (runtimeUrl) => {
    const database: Database = createDatabase(runtimeUrl);
    const identity = createIdentityModule({ provider });
    const modules = activateModules(
      [identity.module],
      {
        database,
        verifier: { verify: () => Promise.resolve(null) },
        humanIdentity: {
          environment: "test",
          issuer: "https://provider.example.test/realms/teluni",
          publicOrigin: "http://127.0.0.1:5173",
          clientId: "teluni-web",
          clientSecret: "synthetic-client-secret",
          provisionerClientId: "teluni-provisioner",
          provisionerClientSecret: "synthetic-provisioner-secret",
          sessionKeys: [{ id: "k1", key: randomBytes(32) }],
        },
      },
      "test",
    );
    const { app, lifecycle } = createApp(pino({ level: "silent" }), undefined, {
      modules,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    lifecycle.markReady();
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    apiUrl = `http://127.0.0.1:${address.port}`;
    ready();
    await new Promise<void>((resolve) => (release = resolve));
    await app.close();
    await database.$disconnect();
  });
  await Promise.race([started, stopped]);
}, 180_000);

afterAll(async () => {
  release?.();
  await stopped;
}, 60_000);

describe("reauthentication and account actions", () => {
  it("requests a new authentication and rejects an older one", async () => {
    const jar = new CookieJar();
    const start = await fetch(`${apiUrl}/auth/login?reauthenticate=true`, {
      redirect: "manual",
    });
    jar.store(start);
    expect(start.status).toBe(303);
    expect(requested).toEqual({ maxAgeSeconds: 0 });
    const callback = await fetch(
      `${apiUrl}/auth/callback?state=state-value&code=code-value`,
      { redirect: "manual", headers: { cookie: jar.header() } },
    );
    expect(callback.headers.get("location")).toBe(
      "/sign-in?error=assurance_not_met",
    );
    expect(
      callback.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("teluni_session=")),
    ).toBe(false);
  });

  it("starts two-step account actions only from a session", async () => {
    for (const action of ["enable", "disable"]) {
      const response = await fetch(`${apiUrl}/auth/login?twoStep=${action}`, {
        redirect: "manual",
      });
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("ignores the retired assurance parameter, starting an ordinary login", async () => {
    const response = await fetch(`${apiUrl}/auth/login?assurance=strong`, {
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(requested).toEqual({});
  });

  it.each(["reauthenticate=false", "twoStep=maybe"])(
    "rejects invalid login parameter values (%s)",
    async (query) => {
      const response = await fetch(`${apiUrl}/auth/login?${query}`, {
        redirect: "manual",
      });
      expect(response.status).toBe(400);
    },
  );
});
