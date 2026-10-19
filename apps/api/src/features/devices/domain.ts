// Framework-independent device rules from the approved device enrollment and
// lifecycle design (docs/project/device-enrollment-design.md, ADR-0027).
import { createHash, createHmac, randomInt } from "node:crypto";

export type DeviceStatus = "ACTIVE" | "REVOKED";
export type DeviceErasure = "NONE" | "PENDING" | "CONFIRMED" | "RESET_RECORDED";
export type Rotation = 0 | 90 | 180 | 270;

export const rotations: readonly Rotation[] = [0, 90, 180, 270];

/** Approved values of the design's abuse limits, validity and retention. */
export const devicePolicy = Object.freeze({
  /** RFC 8628 section 6.1: 20 consonants without look-alikes or vowels. */
  codeAlphabet: "BCDFGHJKLMNPQRSTVWXZ",
  codeLength: 8,
  enrollmentValiditySeconds: 10 * 60,
  pollIntervalSeconds: 5,
  /** A poll this soon after the previous one is too fast. */
  pollToleranceSeconds: 1,
  maxPendingEnrollments: 10_000,
  enrollmentStartsPerAddressPerHour: 20,
  failedClaimsPerPrincipal: 10,
  failedClaimsPerCompany: 30,
  failedClaimWindowSeconds: 15 * 60,
  unclaimedRetentionDays: 1,
  claimedRetentionDays: 30,
  failureRetentionDays: 1,
  /** AT-15: offline authorization ends seven days after the last renewal. */
  offlineAuthorizationDays: 7,
  /** last_seen_at is written at most this often per device. */
  lastSeenWriteSeconds: 60,
  nameMaxLength: 80,
});

/** A device's own report of what it is and supports; never a qualified profile. */
export type DeviceReport = Readonly<{
  appVersion: string;
  protocolVersion: number;
  manufacturer: string;
  model: string;
  osVersion: string;
  display: Readonly<{ width: number; height: number }>;
  rotations: readonly Rotation[];
}>;

export type DeviceFailureCode =
  | "VALIDATION_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_VERSION_CONFLICT"
  | "RATE_LIMITED"
  | "PAIRING_CODE_INVALID"
  | "ENROLLMENT_REJECTED"
  | "ROTATION_UNSUPPORTED"
  | "DEVICE_UNAUTHORIZED"
  | "DEVICE_UNLINKED"
  | "DEVICE_ERASURE_NOT_PENDING";

export class DeviceFailure extends Error {
  readonly code: DeviceFailureCode;
  constructor(code: DeviceFailureCode) {
    super(`Device failure: ${code}`);
    this.name = "DeviceFailure";
    this.code = code;
  }
}

/** A new user code from the platform CSPRNG, uniformly over the alphabet. */
export function generateUserCode(): string {
  const { codeAlphabet, codeLength } = devicePolicy;
  let code = "";
  for (let index = 0; index < codeLength; index += 1)
    code += codeAlphabet[randomInt(codeAlphabet.length)];
  return code;
}

/** The code as shown on screen: two groups of four. */
export function displayUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const codePattern = new RegExp(
  `^[${devicePolicy.codeAlphabet}]{${devicePolicy.codeLength}}$`,
);

/**
 * Entry ignores case, spaces and hyphens. Returns null for anything that
 * cannot be a code, which callers answer like any other invalid code.
 */
export function normalizeUserCode(input: string): string | null {
  const normalized = input.replace(/[\s-]/g, "").toUpperCase();
  return codePattern.test(normalized) ? normalized : null;
}

export type KeyRing = readonly Readonly<{ id: string; key: Buffer }>[];

/** HMAC-SHA-256 of a normalized code under one key of the code key ring. */
export function userCodeHmac(key: Buffer, code: string): Buffer {
  return createHmac("sha256", key).update(code, "utf8").digest();
}

const encoded32Bytes = /^[A-Za-z0-9_-]{43}$/;

/** Decodes a base64url 32-byte value, such as a credential hash on the wire. */
export function decode32Bytes(value: string): Buffer | null {
  if (!encoded32Bytes.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 ? bytes : null;
}

/**
 * The stored form of a device credential: SHA-256 of its 32 bytes. The
 * player sends this hash when enrolling or rotating, and the credential
 * itself only as a bearer token.
 */
export function credentialHash(credential: string): Buffer | null {
  const bytes = decode32Bytes(credential);
  return bytes ? createHash("sha256").update(bytes).digest() : null;
}

/** Trims surrounding whitespace and rejects control characters. */
export function deviceName(value: string): string {
  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > devicePolicy.nameMaxLength ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(name)
  )
    throw new DeviceFailure("VALIDATION_FAILED");
  return name;
}

/** Normalizes a validated report: distinct supported rotations, ascending. */
export function normalizeReport(report: DeviceReport): DeviceReport {
  const supported = [...new Set(report.rotations)].sort((a, b) => a - b);
  if (supported.length === 0 || supported.length !== report.rotations.length)
    throw new DeviceFailure("VALIDATION_FAILED");
  return { ...report, rotations: supported };
}

/** Only a rotation the device reported can be configured. */
export function requireSupportedRotation(
  report: DeviceReport,
  rotation: Rotation,
): void {
  if (!report.rotations.includes(rotation))
    throw new DeviceFailure("ROTATION_UNSUPPORTED");
}
