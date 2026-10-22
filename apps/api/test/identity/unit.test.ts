import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cookieNames,
  isUnsafeMethod,
  safeReturnPath,
} from "../../src/features/identity/domain.js";
import { realmSettings } from "../../scripts/identity-realm.js";
import {
  hashSecret,
  newSecret,
  SessionKeyRing,
} from "../../src/features/identity/session-crypto.js";

describe("identity session rules", () => {
  it.each([
    ["/companies?view=all", "/companies?view=all"],
    ["/", "/"],
    [undefined, "/"],
    ["https://evil.example/", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/api/auth/logout", "/"],
    ["/api", "/"],
    ["/apiary", "/apiary"],
    ["/with space", "/"],
    [`/${"a".repeat(2048)}`, "/"],
  ])("keeps login returns on the panel origin: %s", (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });

  it("names cookies with the host prefix only over HTTPS", () => {
    expect(cookieNames(true)).toEqual({
      session: "__Host-teluni_session",
      login: "__Host-teluni_login",
    });
    expect(cookieNames(false).session).toBe("teluni_session");
  });

  it("treats state-changing methods as unsafe", () => {
    for (const method of ["POST", "put", "PATCH", "DELETE"])
      expect(isUnsafeMethod(method)).toBe(true);
    for (const method of ["GET", "HEAD", "OPTIONS"])
      expect(isUnsafeMethod(method)).toBe(false);
  });
});

describe("session credentials and sealed provider tokens", () => {
  const current = { id: "k2", key: randomBytes(32) };
  const previous = { id: "k1", key: randomBytes(32) };

  it("generates unguessable credentials and stores only their digest", () => {
    const secret = newSecret();
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(newSecret()).not.toBe(secret);
    expect(hashSecret(secret)).toHaveLength(32);
    expect(hashSecret(secret).equals(hashSecret(secret))).toBe(true);
  });

  it("seals values bound to their owner and rejects tampering", () => {
    const ring = new SessionKeyRing([current]);
    const sealed = ring.seal("provider tokens", "session:a");
    expect(sealed.includes(Buffer.from("provider tokens"))).toBe(false);
    expect(ring.open(sealed, "session:a")).toBe("provider tokens");
    expect(() => ring.open(sealed, "session:b")).toThrow();
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] ^= 1;
    expect(() => ring.open(flipped, "session:a")).toThrow();
  });

  it("keeps values readable across key rotation and rejects unknown keys", () => {
    const old = new SessionKeyRing([previous]);
    const sealed = old.seal("value", "row");
    const rotated = new SessionKeyRing([current, previous]);
    expect(rotated.open(sealed, "row")).toBe("value");
    expect(rotated.seal("value", "row").subarray(2, 4).toString()).toBe("k2");
    expect(() => new SessionKeyRing([current]).open(sealed, "row")).toThrow(
      "unknown key",
    );
  });

  it("issues per-session CSRF tokens verifiable during rotation", () => {
    const old = new SessionKeyRing([previous]);
    const rotated = new SessionKeyRing([current, previous]);
    const token = old.csrfToken("session-1");
    expect(rotated.verifyCsrf("session-1", token)).toBe(true);
    expect(rotated.verifyCsrf("session-2", token)).toBe(false);
    expect(rotated.verifyCsrf("session-1", undefined)).toBe(false);
    expect(rotated.verifyCsrf("session-1", `${token}x`)).toBe(false);
    expect(new SessionKeyRing([current]).verifyCsrf("session-1", token)).toBe(
      false,
    );
  });
});

describe("realm mail settings", () => {
  const base = {
    realm: "teluni",
    publicOrigin: "https://app.teluni.test",
    backchannelLogoutUrl: "https://app.teluni.test/api/auth/backchannel-logout",
    apiAudience: "teluni-api",
    webClientSecret: "synthetic-web-secret-000",
    provisionerClientSecret: "synthetic-provisioner-000",
  };

  it("sends Keycloak's mail through an authenticated relay with implicit TLS", () => {
    expect(
      realmSettings({
        ...base,
        smtp: {
          host: "smtp.relay.test",
          port: 465,
          from: "no-reply@notify.teluni.test",
          security: "tls",
          credentials: { username: "relay-user", password: "relay-secret" },
        },
      }).smtpServer,
    ).toEqual({
      host: "smtp.relay.test",
      port: "465",
      from: "no-reply@notify.teluni.test",
      fromDisplayName: "Teluni",
      ssl: "true",
      starttls: "false",
      auth: "true",
      user: "relay-user",
      password: "relay-secret",
    });
  });

  it("keeps a local test sink unauthenticated and without TLS", () => {
    expect(
      realmSettings({
        ...base,
        smtp: { host: "localhost", port: 1025, from: "no-reply@teluni.test" },
      }).smtpServer,
    ).toMatchObject({ ssl: "false", starttls: "false", auth: "false" });
    expect(realmSettings(base)).not.toHaveProperty("smtpServer");
  });
});
