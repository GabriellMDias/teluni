// Shared email-address rules for configuration and modules. The shape is
// deliberately conservative: one @, no spaces, quotes or angle brackets, and a
// dotted domain. Only delivery proves that a mailbox exists.
const emailAddressPattern =
  /^[^\s@<>",;]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** True for an address this application accepts as a sender or recipient. */
export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && emailAddressPattern.test(value);
}

/**
 * The comparison form of an address: trimmed and lower-cased. The identity
 * provider stores addresses in lower case, so equal addresses compare equal.
 */
export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}
