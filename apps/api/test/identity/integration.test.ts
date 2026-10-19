import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  requireStrongAuthentication,
  SessionFailure,
} from "../../src/features/identity/public.js";
import {
  PanelBrowser,
  realm,
  syntheticPerson,
  withIdentityStack,
  type IdentityStack,
} from "./stack.js";

let stack: IdentityStack;
let release: () => void;
let stopped: Promise<void>;

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => (ready = resolve));
  stopped = withIdentityStack(async (handle) => {
    stack = handle;
    ready();
    await new Promise<void>((resolve) => (release = resolve));
  });
  await Promise.race([started, stopped]);
}, 300_000);

afterAll(async () => {
  release?.();
  await stopped;
}, 120_000);

async function sessionRow(sessionId: string) {
  const { rows } = await stack.sql.query<{
    state: string;
    revocation_reason: string | null;
    last_activity_at: Date;
  }>(
    "SELECT state, revocation_reason, last_activity_at FROM human_sessions WHERE id = $1",
    [sessionId],
  );
  return rows[0];
}

async function summary(
  browser: PanelBrowser,
  headers: Record<string, string> = {},
) {
  const response = await browser.request("/auth/session", { headers });
  return {
    status: response.status,
    body: (await response.json()) as {
      principalId: string;
      sessionId: string;
      state: string;
      csrfToken: string;
      error?: { code: string };
    },
  };
}

describe("identity module against real Keycloak and PostgreSQL", () => {
  it("provisions one stable principal and starts a session at the requested path", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    const finished = await browser.login(
      person.credentials,
      "/companies?view=all",
    );
    const current = await summary(browser);
    expect(await stack.profiles.getMany([current.body.principalId])).toEqual([
      {
        principalId: current.body.principalId,
        displayName: "Synthetic User",
        email: person.credentials.username,
      },
    ]);
    expect(finished.status).toBe(303);
    expect(finished.headers.get("location")).toBe("/companies?view=all");
    expect(finished.headers.get("cache-control")).toBe("no-store");
    const cookie = finished.headers
      .getSetCookie()
      .find((value) => value.startsWith("teluni_session="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);

    const first = await summary(browser);
    expect(first.status).toBe(200);
    expect(first.body.state).toBe("ACTIVE");
    const { rows } = await stack.sql.query<{ id: string; subject: string }>(
      "SELECT id, subject FROM principals WHERE subject = $1",
      [person.userId],
    );
    expect(rows).toEqual([
      { id: first.body.principalId, subject: person.userId },
    ]);
    const user = await stack.admin.request(
      "GET",
      `/realms/${realm}/users/${person.userId}`,
    );
    const { attributes } = (await user.json()) as {
      attributes: Record<string, string[]>;
    };
    expect(attributes.orion_principal_id).toEqual([first.body.principalId]);

    // A later login, even in another browser, reuses the same principal.
    expect(
      (
        await stack.admin.request(
          "PUT",
          `/realms/${realm}/users/${person.userId}`,
          { firstName: "Updated", lastName: "User" },
        )
      ).status,
    ).toBe(204);
    const second = new PanelBrowser(stack);
    await second.login(person.credentials);
    expect((await summary(second)).body.principalId).toBe(
      first.body.principalId,
    );
    expect(await stack.profiles.getMany([first.body.principalId])).toEqual([
      {
        principalId: first.body.principalId,
        displayName: "Updated User",
        email: person.credentials.username,
      },
    ]);
    // Stored state never contains the recoverable cookie credential.
    const stored = await stack.sql.query<{ token_hash: Buffer }>(
      "SELECT token_hash FROM human_sessions WHERE id = $1",
      [first.body.sessionId],
    );
    expect(stored.rows[0].token_hash).toHaveLength(32);
  }, 120_000);

  it("rejects replayed, unbound and tampered callbacks", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    const callback = await browser.beginLogin(person.credentials);
    // A callback reaching another browser lacks the bound login attempt.
    const stranger = new PanelBrowser(stack);
    const unbound = await stranger.finishLogin(callback);
    expect(unbound.headers.get("location")).toBe(
      "/sign-in?error=login_expired",
    );

    const tampered = new URL(callback);
    tampered.searchParams.set("state", "forged");
    const forged = await browser.request(
      `${tampered.pathname}${tampered.search}`,
    );
    expect(forged.headers.get("location")).toBe("/sign-in?error=login_expired");

    // The attempt was not consumed by the forged state, so the real callback
    // succeeds once; replaying it afterwards fails.
    const genuine = new PanelBrowser(stack);
    const genuineCallback = await genuine.beginLogin(person.credentials);
    const accepted = await genuine.finishLogin(genuineCallback);
    expect(accepted.headers.get("location")).toBe("/");
    const replayed = await genuine.finishLogin(genuineCallback);
    expect(replayed.headers.get("location")).toBe(
      "/sign-in?error=login_expired",
    );
  }, 120_000);

  it("requires the session CSRF token and the panel origin for unsafe requests", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    await browser.login(person.credentials);
    const missing = await browser.request("/auth/logout", {
      method: "POST",
      headers: { origin: stack.publicOrigin },
    });
    expect(missing.status).toBe(403);
    expect(
      ((await missing.json()) as { error: { code: string } }).error.code,
    ).toBe("CSRF_VALIDATION_FAILED");
    const crossSite = await browser.request("/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "x-csrf-token": browser.csrfToken!,
      },
    });
    expect(crossSite.status).toBe(403);
    expect((await summary(browser)).status).toBe(200);

    const logout = await browser.mutate("/auth/logout");
    expect(logout.status).toBe(204);
    expect((await summary(browser)).status).toBe(401);
  }, 120_000);

  it("ends the provider session at logout so the next login asks for credentials", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    await browser.login(person.credentials);
    expect((await browser.mutate("/auth/logout")).status).toBe(204);
    const start = await browser.request("/auth/login");
    const page = await fetch(start.headers.get("location")!, {
      redirect: "manual",
      headers: { cookie: browser.provider.header() },
    });
    // A live SSO session would redirect straight back with a code.
    expect(page.status).toBe(200);
  }, 120_000);

  it("lists and ends only the caller's own sessions", async () => {
    const person = await syntheticPerson(stack);
    const laptop = new PanelBrowser(stack);
    const phone = new PanelBrowser(stack);
    await laptop.login(person.credentials);
    await phone.login(person.credentials);
    const phoneSession = (await summary(phone)).body.sessionId;
    const listed = await laptop.request("/auth/sessions");
    const { items } = (await listed.json()) as {
      items: { id: string; current: boolean }[];
    };
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.current)).toHaveLength(1);

    const other = await syntheticPerson(stack);
    const intruder = new PanelBrowser(stack);
    await intruder.login(other.credentials);
    const foreign = await intruder.mutate(
      `/auth/sessions/${phoneSession}`,
      "DELETE",
    );
    expect(foreign.status).toBe(404);
    expect((await summary(phone)).status).toBe(200);

    const ended = await laptop.mutate(
      `/auth/sessions/${phoneSession}`,
      "DELETE",
    );
    expect(ended.status).toBe(204);
    expect((await summary(phone)).status).toBe(401);
    expect((await summary(laptop)).status).toBe(200);
    expect((await sessionRow(phoneSession))?.revocation_reason).toBe(
      "TERMINATED_BY_USER",
    );
  }, 120_000);

  it("holds a sixth session pending until another session ends", async () => {
    const person = await syntheticPerson(stack);
    const browsers = [];
    for (let index = 0; index < 5; index += 1) {
      const browser = new PanelBrowser(stack);
      await browser.login(person.credentials);
      browsers.push(browser);
    }
    const sixth = new PanelBrowser(stack);
    await sixth.login(person.credentials);
    const pending = await summary(sixth);
    expect(pending.status).toBe(200);
    expect(pending.body.state).toBe("PENDING_LIMIT");
    await expect(
      stack.sessions.authenticate({
        method: "GET",
        headers: { cookie: sixth.api.header() },
      }),
    ).rejects.toMatchObject({ code: "SESSION_LIMIT_REACHED" });

    const oldest = (await summary(browsers[0])).body.sessionId;
    expect(
      (await sixth.mutate(`/auth/sessions/${oldest}`, "DELETE")).status,
    ).toBe(204);
    expect((await summary(sixth)).body.state).toBe("ACTIVE");
    const context = await stack.sessions.authenticate({
      method: "GET",
      headers: { cookie: sixth.api.header() },
    });
    expect(context.principalId).toBe(pending.body.principalId);
  }, 180_000);

  it("revokes sessions ended at the provider through back-channel logout", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    await browser.login(person.credentials);
    const { sessionId } = (await summary(browser)).body;
    const logout = await stack.admin.request(
      "POST",
      `/realms/${realm}/users/${person.userId}/logout`,
    );
    expect(logout.status).toBe(204);
    let row = await sessionRow(sessionId);
    for (
      let attempt = 0;
      attempt < 50 && row?.state !== "REVOKED";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      row = await sessionRow(sessionId);
    }
    expect(row).toMatchObject({
      state: "REVOKED",
      revocation_reason: "PROVIDER_LOGOUT",
    });
    expect((await summary(browser)).status).toBe(401);
  }, 120_000);

  it("denies within the revalidation bound when the provider disables the user", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    await browser.login(person.credentials);
    const { sessionId } = (await summary(browser)).body;
    const current = await stack.admin.request(
      "GET",
      `/realms/${realm}/users/${person.userId}`,
    );
    const user = (await current.json()) as Record<string, unknown>;
    await stack.admin.request(
      "PUT",
      `/realms/${realm}/users/${person.userId}`,
      {
        ...user,
        enabled: false,
      },
    );
    // Simulate the 30-second revalidation interval elapsing.
    await stack.sql.query(
      "UPDATE human_sessions SET provider_checked_at = now() - interval '31 seconds' WHERE id = $1",
      [sessionId],
    );
    expect((await summary(browser)).status).toBe(401);
    const row = await sessionRow(sessionId);
    expect(row?.state).toBe("REVOKED");
    expect(["PROVIDER_INACTIVE", "PROVIDER_LOGOUT"]).toContain(
      row?.revocation_reason,
    );
  }, 120_000);

  it("refreshes provider tokens once under concurrent requests", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    await browser.login(person.credentials);
    const { sessionId } = (await summary(browser)).body;
    const before = await stack.sql.query<{ provider_tokens: Buffer }>(
      "SELECT provider_tokens FROM human_sessions WHERE id = $1",
      [sessionId],
    );
    await stack.sql.query(
      "UPDATE human_sessions SET access_token_expires_at = now() WHERE id = $1",
      [sessionId],
    );
    // Several waves widen the window in which a request reads the row before
    // another request rotates the tokens.
    for (let wave = 0; wave < 3; wave += 1) {
      await stack.sql.query(
        "UPDATE human_sessions SET access_token_expires_at = now() WHERE id = $1",
        [sessionId],
      );
      const results = await Promise.all(
        Array.from({ length: 10 }, () => summary(browser)),
      );
      expect(results.map((result) => result.status)).toEqual(
        Array(10).fill(200),
      );
    }
    const after = await stack.sql.query<{
      provider_tokens: Buffer;
      refresh_lease_until: Date | null;
      state: string;
    }>(
      "SELECT provider_tokens, refresh_lease_until, state FROM human_sessions WHERE id = $1",
      [sessionId],
    );
    expect(after.rows[0].state).toBe("ACTIVE");
    expect(after.rows[0].refresh_lease_until).toBeNull();
    expect(
      after.rows[0].provider_tokens.equals(before.rows[0].provider_tokens),
    ).toBe(false);
    // A second wave proves the rotated refresh token remains usable.
    await stack.sql.query(
      "UPDATE human_sessions SET access_token_expires_at = now() WHERE id = $1",
      [sessionId],
    );
    expect((await summary(browser)).status).toBe(200);
  }, 120_000);

  it("expires idle sessions, ignores background activity and denies disabled principals", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    await browser.login(person.credentials);
    const { sessionId, principalId } = (await summary(browser)).body;
    await stack.sql.query(
      "UPDATE human_sessions SET last_activity_at = now() - interval '20 seconds' WHERE id = $1",
      [sessionId],
    );
    const before = (await sessionRow(sessionId)).last_activity_at;
    expect(
      (await summary(browser, { "x-teluni-activity": "background" })).status,
    ).toBe(200);
    expect((await sessionRow(sessionId)).last_activity_at).toEqual(before);
    expect((await summary(browser)).status).toBe(200);
    expect(
      (await sessionRow(sessionId)).last_activity_at.getTime(),
    ).toBeGreaterThan(before.getTime());

    await stack.sql.query(
      "UPDATE human_sessions SET last_activity_at = now() - interval '31 minutes' WHERE id = $1",
      [sessionId],
    );
    expect((await summary(browser)).status).toBe(401);
    expect((await sessionRow(sessionId))?.revocation_reason).toBe("EXPIRED");

    const again = new PanelBrowser(stack);
    await again.login(person.credentials);
    await stack.sql.query(
      "UPDATE principals SET status = 'DISABLED', disabled_at = now() WHERE id = $1",
      [principalId],
    );
    expect((await summary(again)).status).toBe(401);
    const blocked = await again.finishLogin(
      await again.beginLogin(person.credentials),
    );
    expect(blocked.headers.get("location")).toBe(
      "/sign-in?error=account_unavailable",
    );
  }, 120_000);

  it("rejects requests without a session cookie, including bearer-only requests", async () => {
    await expect(
      stack.sessions.authenticate({
        method: "GET",
        headers: { authorization: "Bearer not-a-session" },
      }),
    ).rejects.toBeInstanceOf(SessionFailure);
    const response = await fetch(`${stack.apiUrl}/auth/session`);
    expect(response.status).toBe(401);
  });

  it("rejects invalid back-channel logout tokens", async () => {
    const response = await fetch(`${stack.apiUrl}/auth/backchannel-logout`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: "eyJhbGciOiJub25lIn0.e30." }),
    });
    expect(response.status).toBe(400);
  });

  it("only redirects logins to same-origin panel paths", async () => {
    const browser = new PanelBrowser(stack);
    for (const target of [
      "https://evil.example/",
      "//evil.example",
      "/api/auth/logout",
    ]) {
      const start = await browser.request(
        `/auth/login?returnTo=${encodeURIComponent(target)}`,
      );
      expect(start.status).toBe(303);
      const { rows } = await stack.sql.query<{ return_to: string }>(
        "SELECT return_to FROM oidc_login_attempts ORDER BY created_at DESC LIMIT 1",
      );
      expect(rows[0].return_to).toBe("/");
    }
  });

  it("marks only stepped-up sessions as strongly and recently authenticated", async () => {
    const person = await syntheticPerson(stack);
    const browser = new PanelBrowser(stack);
    await browser.login(person.credentials);
    const standard = await summary(browser);
    expect(standard.body).toMatchObject({ strongAuthenticatedAt: null });
    const context = () =>
      stack.sessions.authenticate({
        method: "GET",
        headers: { cookie: browser.api.header() },
      });
    const standardContext = await context();
    expect(() => requireStrongAuthentication(standardContext)).toThrow(
      expect.objectContaining({ code: "STRONG_AUTHENTICATION_REQUIRED" }),
    );

    // Step-up enrolls the synthetic authenticator and replaces the session.
    const stepped = await browser.login(
      person.credentials,
      "/account/sessions",
      "strong",
    );
    expect(stepped.headers.get("location")).toBe("/account/sessions");
    expect(browser.authenticator.secret).toBeTruthy();
    const strong = await summary(browser);
    expect(strong.body.sessionId).not.toBe(standard.body.sessionId);
    expect(strong.body.principalId).toBe(standard.body.principalId);
    const strongContext = await context();
    expect(() =>
      requireStrongAuthentication(strongContext, { recent: true }),
    ).not.toThrow();
    const { rows } = await stack.sql.query<{ revocation_reason: string }>(
      "SELECT revocation_reason FROM human_sessions WHERE id = $1",
      [standard.body.sessionId],
    );
    expect(rows[0].revocation_reason).toBe("REPLACED");

    // Six minutes later the session stays strong but is no longer recent.
    await stack.sql.query(
      "UPDATE human_sessions SET strong_authenticated_at = now() - interval '6 minutes' WHERE id = $1",
      [strong.body.sessionId],
    );
    const aged = await context();
    expect(() => requireStrongAuthentication(aged)).not.toThrow();
    expect(() => requireStrongAuthentication(aged, { recent: true })).toThrow(
      expect.objectContaining({ code: "RECENT_AUTHENTICATION_REQUIRED" }),
    );

    // A recent step-up asks for the password and code again.
    await browser.login(person.credentials, "/", "recent");
    const renewed = await context();
    expect(() =>
      requireStrongAuthentication(renewed, { recent: true }),
    ).not.toThrow();
  }, 180_000);
});
