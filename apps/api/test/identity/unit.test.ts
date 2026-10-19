import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cookieNames,
  isUnsafeMethod,
  safeReturnPath,
} from "../../src/features/identity/domain.js";
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
