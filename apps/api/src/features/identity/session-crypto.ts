import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** An unguessable credential for a cookie: 32 random bytes, base64url. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Stored lookup form of a credential; the recoverable value is never kept. */
export function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

type DerivedKey = Readonly<{ id: string; encryption: Buffer; csrf: Buffer }>;

const format = 1;

/**
 * AES-256-GCM sealing and HMAC-SHA256 CSRF tokens over the configured key
 * ring. The first key protects new values; every key stays readable so keys
 * can rotate with overlap. Additional data binds a blob to its owning row.
 */
export class SessionKeyRing {
  readonly #keys: readonly DerivedKey[];

  constructor(keys: readonly Readonly<{ id: string; key: Buffer }>[]) {
    if (keys.length === 0) throw new Error("Session key ring is empty");
    this.#keys = keys.map(({ id, key }) => ({
      id,
      encryption: Buffer.from(
        hkdfSync("sha256", key, Buffer.alloc(0), "teluni:provider-tokens", 32),
      ),
      csrf: Buffer.from(
        hkdfSync("sha256", key, Buffer.alloc(0), "teluni:csrf", 32),
      ),
    }));
  }

  seal(plaintext: string, binding: string): Buffer {
    const key = this.#keys[0];
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.encryption, iv);
    cipher.setAAD(Buffer.from(binding, "utf8"));
    const body = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const id = Buffer.from(key.id, "utf8");
    return Buffer.concat([
      Buffer.from([format, id.length]),
      id,
      iv,
      cipher.getAuthTag(),
      body,
    ]);
  }

  open(sealed: Uint8Array, binding: string): string {
    const blob = Buffer.from(sealed);
    if (blob[0] !== format) throw new Error("Unsupported sealed value");
    const idLength = blob[1];
    const id = blob.subarray(2, 2 + idLength).toString("utf8");
    const key = this.#keys.find((candidate) => candidate.id === id);
    if (!key) throw new Error("Sealed value uses an unknown key");
    const offset = 2 + idLength;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.encryption,
      blob.subarray(offset, offset + 12),
    );
    decipher.setAAD(Buffer.from(binding, "utf8"));
    decipher.setAuthTag(blob.subarray(offset + 12, offset + 28));
    return Buffer.concat([
      decipher.update(blob.subarray(offset + 28)),
      decipher.final(),
    ]).toString("utf8");
  }

  csrfToken(sessionId: string): string {
    return createHmac("sha256", this.#keys[0].csrf)
      .update(`csrf:${sessionId}`)
      .digest("base64url");
  }

  verifyCsrf(sessionId: string, token: string | undefined): boolean {
    if (!token) return false;
    const presented = Buffer.from(token, "utf8");
    return this.#keys.some((key) => {
      const expected = Buffer.from(
        createHmac("sha256", key.csrf)
          .update(`csrf:${sessionId}`)
          .digest("base64url"),
        "utf8",
      );
      return (
        expected.length === presented.length &&
        timingSafeEqual(expected, presented)
      );
    });
  }
}
