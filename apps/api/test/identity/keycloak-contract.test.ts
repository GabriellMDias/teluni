import { randomBytes, randomUUID } from "node:crypto";
import { decodeProtectedHeader, decodeJwt } from "jose";
import * as oidc from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccessTokenVerifier } from "../../src/authentication.js";
import {
  principalAttribute,
  provisionerClientId,
  provisionTeluniRealm,
  webClientId,
} from "../../scripts/identity-realm.js";
import { withKeycloak, type KeycloakAdmin } from "../../scripts/keycloak.js";
import { createSyntheticUser, signInAtProvider } from "./keycloak-browser.js";

// Qualifies the pinned Keycloak build against the realm contract and the
// unchanged ADR-0012 verifier, independently of the API's identity module.
const realm = "teluni";
const publicOrigin = "http://127.0.0.1:5173";
const audience = "teluni-api";
const webSecret = randomBytes(24).toString("base64url");
const provisionerSecret = randomBytes(24).toString("base64url");
const password = `Synthetic-${randomBytes(9).toString("base64url")}`;

let admin: KeycloakAdmin;
let release: () => void;
let stopped: Promise<void>;
let issuer: string;
let web: oidc.Configuration;

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  stopped = withKeycloak(async (handle) => {
    admin = handle;
    ready();
    await new Promise<void>((resolve) => (release = resolve));
  });
  await Promise.race([started, stopped]);
  await provisionTeluniRealm(admin, {
    realm,
    publicOrigin,
    backchannelLogoutUrl: "http://127.0.0.1:9/auth/backchannel-logout",
    apiAudience: audience,
    webClientSecret: webSecret,
    provisionerClientSecret: provisionerSecret,
  });
  issuer = `${admin.baseUrl}/realms/${realm}`;
  web = await oidc.discovery(
    new URL(issuer),
    webClientId,
    undefined,
    oidc.ClientSecretBasic(webSecret),
    { execute: [oidc.allowInsecureRequests] },
  );
}, 240_000);

afterAll(async () => {
  release?.();
  await stopped;
}, 60_000);

async function browserLogin(email: string) {
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(web, {
    redirect_uri: `${publicOrigin}/api/auth/callback`,
    scope: "openid",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const callback = await signInAtProvider(url.href, {
    username: email,
    password,
  });
  return oidc.authorizationCodeGrant(web, callback, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce,
  });
}

async function provisionerToken(): Promise<string> {
  const provisioner = await oidc.discovery(
    new URL(issuer),
    provisionerClientId,
    undefined,
    oidc.ClientSecretBasic(provisionerSecret),
    { execute: [oidc.allowInsecureRequests] },
  );
  return (await oidc.clientCredentialsGrant(provisioner)).access_token;
}

describe("pinned Keycloak realm contract", () => {
  it("issues at+jwt access tokens that pass the unchanged verifier only after trusted principal provisioning", async () => {
    const email = `owner-${randomUUID()}@example.test`;
    const userId = await createSyntheticUser(admin, realm, { email, password });
    const first = await browserLogin(email);
    expect(decodeProtectedHeader(first.access_token).typ).toBe("at+jwt");
    const firstClaims = decodeJwt(first.access_token);
    expect(firstClaims.aud).toContain(audience);
    expect(firstClaims.aud).toContain(webClientId);
    expect(firstClaims.orion_actor_type).toBe("human");
    expect(firstClaims[principalAttribute]).toBeUndefined();
    expect(typeof firstClaims.sub).toBe("string");
    expect(typeof firstClaims.scope).toBe("string");

    const verifier = createAccessTokenVerifier({
      issuer,
      audience,
      jwksUrl: `${issuer}/protocol/openid-connect/certs`,
    });
    // Without the application principal the verifier fails closed.
    expect(await verifier.verify(`Bearer ${first.access_token}`)).toBeNull();

    const principalId = randomUUID();
    const token = await provisionerToken();
    const user = await fetch(
      `${admin.baseUrl}/admin/realms/${realm}/users/${userId}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(user.status).toBe(200);
    const representation = (await user.json()) as Record<string, unknown>;
    const updated = await fetch(
      `${admin.baseUrl}/admin/realms/${realm}/users/${userId}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...representation,
          attributes: { [principalAttribute]: [principalId] },
        }),
      },
    );
    expect(updated.status).toBe(204);

    const refreshed = await oidc.refreshTokenGrant(web, first.refresh_token!);
    expect(decodeJwt(refreshed.access_token)[principalAttribute]).toBe(
      principalId,
    );
    const principal = await verifier.verify(`Bearer ${refreshed.access_token}`);
    expect(principal?.id).toBe(principalId);
    // Refresh tokens rotate with zero reuse.
    await expect(
      oidc.refreshTokenGrant(web, first.refresh_token!),
    ).rejects.toThrow();
  }, 120_000);

  it("prevents users from writing the administrator-only principal attribute", async () => {
    const email = `self-${randomUUID()}@example.test`;
    const userId = await createSyntheticUser(admin, realm, { email, password });
    // Sign in to Keycloak's own account console, the user's self-service channel.
    const account = await oidc.discovery(
      new URL(issuer),
      "account-console",
      undefined,
      oidc.None(),
      {
        execute: [oidc.allowInsecureRequests],
      },
    );
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const redirect = `${issuer}/account/`;
    const url = oidc.buildAuthorizationUrl(account, {
      redirect_uri: redirect,
      scope: "openid",
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
    });
    const callback = await signInAtProvider(url.href, {
      username: email,
      password,
    });
    const tokens = await oidc.authorizationCodeGrant(account, callback, {
      pkceCodeVerifier: codeVerifier,
      expectedState: state,
    });
    const headers = {
      authorization: `Bearer ${tokens.access_token}`,
      accept: "application/json",
      "content-type": "application/json",
    };
    const profile = await fetch(`${issuer}/account`, { headers });
    expect(profile.status).toBe(200);
    const current = (await profile.json()) as Record<string, unknown>;
    expect(JSON.stringify(current)).not.toContain(principalAttribute);
    const attempt = await fetch(`${issuer}/account`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...current,
        attributes: { [principalAttribute]: [randomUUID()] },
      }),
    });
    expect(attempt.status).toBeLessThan(500);
    const stored = await admin.request(
      "GET",
      `/realms/${realm}/users/${userId}`,
    );
    const { attributes } = (await stored.json()) as {
      attributes?: Record<string, string[]>;
    };
    expect(attributes?.[principalAttribute]).toBeUndefined();
  }, 120_000);

  it("rejects password, client-credential and implicit grants on the human client", async () => {
    const direct = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${webClientId}:${webSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: "nobody@example.test",
        password,
      }),
    });
    expect(direct.status).toBe(400);
    expect(((await direct.json()) as { error: string }).error).toBe(
      "unauthorized_client",
    );
    await expect(oidc.clientCredentialsGrant(web)).rejects.toThrow();
    const implicit = await fetch(
      `${issuer}/protocol/openid-connect/auth?${new URLSearchParams({
        client_id: webClientId,
        response_type: "token",
        redirect_uri: `${publicOrigin}/api/auth/callback`,
        scope: "openid",
        nonce: "n",
        state: "s",
      })}`,
      { redirect: "manual" },
    );
    const location = implicit.headers.get("location") ?? "";
    expect(location).not.toContain("access_token");
  }, 60_000);

  it("reports ended provider sessions through introspection", async () => {
    const email = `session-${randomUUID()}@example.test`;
    const userId = await createSyntheticUser(admin, realm, { email, password });
    const tokens = await browserLogin(email);
    expect(
      (await oidc.tokenIntrospection(web, tokens.access_token)).active,
    ).toBe(true);
    const logout = await admin.request(
      "POST",
      `/realms/${realm}/users/${userId}/logout`,
    );
    expect(logout.status).toBe(204);
    expect(
      (await oidc.tokenIntrospection(web, tokens.access_token)).active,
    ).toBe(false);
  }, 60_000);

  it("reports disabled users as inactive through introspection", async () => {
    const email = `disabled-${randomUUID()}@example.test`;
    const userId = await createSyntheticUser(admin, realm, { email, password });
    const tokens = await browserLogin(email);
    const current = await admin.request(
      "GET",
      `/realms/${realm}/users/${userId}`,
    );
    const representation = (await current.json()) as Record<string, unknown>;
    const disabled = await admin.request(
      "PUT",
      `/realms/${realm}/users/${userId}`,
      { ...representation, enabled: false },
    );
    expect(disabled.status).toBe(204);
    expect(
      (await oidc.tokenIntrospection(web, tokens.access_token)).active,
    ).toBe(false);
  }, 60_000);
});
