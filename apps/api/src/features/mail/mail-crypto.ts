import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const format = 1;

/**
 * AES-256-GCM sealing of secret message parameters over the mail key ring.
 * The first key seals new values; every key stays readable so keys can
 * rotate with overlap. The message ID is bound as additional data, so a
 * sealed value cannot be moved to another message.
 */
export class MailKeyRing {
  readonly #keys: readonly Readonly<{ id: string; encryption: Buffer }>[];

  constructor(keys: readonly Readonly<{ id: string; key: Buffer }>[]) {
    if (keys.length === 0) throw new Error("Mail key ring is empty");
    this.#keys = keys.map(({ id, key }) => ({
      id,
      encryption: Buffer.from(
        hkdfSync("sha256", key, Buffer.alloc(0), "teluni:outbound-mail", 32),
      ),
    }));
  }

  seal(plaintext: string, messageId: string): Buffer {
    const key = this.#keys[0];
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.encryption, iv);
    cipher.setAAD(Buffer.from(messageId, "utf8"));
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

  open(sealed: Uint8Array, messageId: string): string {
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
    decipher.setAAD(Buffer.from(messageId, "utf8"));
    decipher.setAuthTag(blob.subarray(offset + 12, offset + 28));
    return Buffer.concat([
      decipher.update(blob.subarray(offset + 28)),
      decipher.final(),
    ]).toString("utf8");
  }
}
