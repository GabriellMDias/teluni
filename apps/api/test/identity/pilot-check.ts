import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { keycloakAdmin } from "../../scripts/keycloak.js";
import {
  CookieJar,
  createSyntheticUser,
  signInAtProvider,
} from "./keycloak-browser.js";

// Executed only by the disposable deployment rehearsal, inside its release
// image. Exercise the built API through public TLS while administration uses
// the private container network. Never print credentials, cookies or tokens.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing rehearsal setting ${name}`);
  return value;
}

const origin = required("TELUNI_PUBLIC_ORIGIN");
const admin = keycloakAdmin(required("TELUNI_KEYCLOAK_ADMIN_URL"), {
  username: required("TELUNI_KEYCLOAK_ADMIN_USERNAME"),
  password: required("TELUNI_KEYCLOAK_ADMIN_PASSWORD"),
});
const realm = "teluni";
const expectedOperatorId = process.argv
  .find((argument) => argument.startsWith("--operator="))
  ?.slice("--operator=".length);
const operator = expectedOperatorId !== undefined;
const email = operator
  ? required("TELUNI_PRESENTATION_USERNAME")
  : `rehearsal-${randomBytes(8).toString("hex")}@example.test`;
const password = operator
  ? required("TELUNI_PRESENTATION_PASSWORD")
  : `Synthetic-${randomBytes(24).toString("base64url")}`;
async function operatorId() {
  assert.equal(email, "presenter@example.test");
  const response = await admin.request(
    "GET",
    `/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`,
  );
  assert.equal(response.status, 200);
  const users = (await response.json()) as {
    id: string;
    attributes?: Record<string, string[]>;
  }[];
  assert.equal(users.length, 1);
  assert.equal(users[0].id, expectedOperatorId);
  return users[0].id;
}
const userId = operator
  ? await operatorId()
  : await createSyntheticUser(admin, realm, { email, password });
const jar = new CookieJar();

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", jar.header());
  const response = await fetch(`${origin}/api${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });
  jar.store(response);
  return response;
}

try {
  const start = await request("/auth/login?returnTo=%2Fcompanies");
  assert.equal(start.status, 303, "Login must start through the public proxy");
  const authorization = start.headers.get("location")!;
  const authUrl = new URL(authorization);
  const authOrigin = authUrl.origin;
  const context = authUrl.pathname.split("/realms/")[0];
  const blocked = await fetch(
    `${authOrigin}${context}/admin/realms/${realm}/users/${userId}`,
    { redirect: "manual" },
  );
  assert.equal(
    blocked.status,
    404,
    "Administrative user endpoints must stay private",
  );
  const callback = await signInAtProvider(authorization, {
    username: email,
    password,
  });
  assert.equal(callback.origin, origin, "OIDC must return to the public panel");
  const finished = await request(`/auth/callback${callback.search}`);
  assert.equal(finished.status, 303);
  assert.equal(
    finished.headers.get("location"),
    "/companies",
    "First login must finish principal provisioning",
  );
  assert(
    finished.headers
      .getSetCookie()
      .some(
        (cookie) =>
          cookie.startsWith("__Host-teluni_session=") &&
          /; Secure/i.test(cookie) &&
          /; HttpOnly/i.test(cookie),
      ),
  );
  const current = await request("/auth/session");
  assert.equal(current.status, 200);
  const session = (await current.json()) as {
    principalId: string;
    state: string;
    csrfToken: string;
  };
  assert.equal(session.state, "ACTIVE");
  const user = await admin.request("GET", `/realms/${realm}/users/${userId}`);
  assert.equal(user.status, 200);
  const representation = (await user.json()) as {
    attributes: Record<string, string[]>;
  };
  assert.deepEqual(representation.attributes.orion_principal_id, [
    session.principalId,
  ]);
  const providerSessions = () =>
    admin.request("GET", `/realms/${realm}/users/${userId}/sessions`);
  const before = await providerSessions();
  assert.equal(before.status, 200);
  assert(
    ((await before.json()) as unknown[]).length > 0,
    "Provider login must have an active session",
  );
  const previousCookie = jar.header();
  const ended = await request("/auth/sessions/terminate-all", {
    method: "POST",
    headers: { origin, "x-csrf-token": session.csrfToken },
  });
  assert.equal(
    ended.status,
    204,
    "Administrative session termination must use the private path",
  );
  assert.equal((await request("/auth/session")).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/auth/session`, {
        headers: { cookie: previousCookie },
        redirect: "manual",
      })
    ).status,
    401,
    "A retained session credential must also be revoked",
  );
  const after = await providerSessions();
  assert.equal(after.status, 200);
  assert.deepEqual(
    await after.json(),
    [],
    "Provider sessions must also be terminated",
  );
  console.log("rehearsal_identity_passed");
} finally {
  if (!operator) {
    const removed = await admin.request(
      "DELETE",
      `/realms/${realm}/users/${userId}`,
    );
    assert.equal(
      removed.status,
      204,
      "Synthetic provider identity cleanup must succeed",
    );
  }
}
