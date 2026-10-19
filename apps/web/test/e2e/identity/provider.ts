import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

// Helpers for driving the real Keycloak pages in browser journeys.

/** RFC 6238 code (SHA-1, six digits, 30 s) for an enrolled synthetic secret. */
export function totp(secret: string): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(secret, "utf8"))
    .update(message)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

export async function enterCredentials(
  page: Page,
  user: { email: string; password: string },
): Promise<void> {
  await page.locator("#username").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.locator("#kc-login").click();
}

/** Completes Keycloak's authenticator enrollment and returns the secret. */
export async function enrollAuthenticator(page: Page): Promise<string> {
  const secret = await page.locator("#totpSecret").inputValue();
  await page.locator("#totp").fill(totp(secret));
  await page.locator("#saveTOTPBtn").click();
  return secret;
}
