import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

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

/**
 * A new person's first sign-in returns through the optional two-step
 * suggestion; journeys that are not about it leave it with "Agora não".
 */
export async function skipTwoStepSuggestion(page: Page): Promise<void> {
  await page.waitForURL((url) => !url.pathname.includes("/realms/"), {
    timeout: 20_000,
  });
  if (new URL(page.url()).pathname === "/welcome/two-step")
    await page.getByRole("link", { name: /^(Agora não|Not now)$/ }).click();
}

/**
 * Signs in at the provider. `then: "skip-suggestion"` (the default) also
 * leaves the first-sign-in suggestion; `"stay"` stops after submitting.
 */
export async function enterCredentials(
  page: Page,
  user: { email: string; password: string },
  then: "skip-suggestion" | "stay" = "skip-suggestion",
): Promise<void> {
  await page.locator("#username").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.locator("#kc-login").click();
  if (then === "skip-suggestion") await skipTwoStepSuggestion(page);
}

/**
 * Keycloak's new-password page after an email link (verification or reset).
 * Teluni's version always ends the person's other sessions and says so (P15).
 */
export async function choosePassword(
  page: Page,
  password: string,
): Promise<void> {
  await expect(page.locator("#password-new")).toBeVisible({ timeout: 20_000 });
  await page.locator("#password-new").fill(password);
  await page.locator("#password-confirm").fill(password);
  await expect(page.locator("#teluni-logout-notice")).toBeVisible();
  await page.locator("#kc-submit").click();
}

/** Keycloak's registration page, after which it emails a confirmation link. */
export async function registerAccount(
  page: Page,
  email: string,
): Promise<void> {
  await expect(page.locator("#kc-register-form")).toBeVisible({
    timeout: 20_000,
  });
  await page.locator("#email").fill(email);
  await page.locator("#firstName").fill("Nova");
  await page.locator("#lastName").fill("Pessoa");
  await page.locator("#kc-form-buttons [type=submit]").click();
  // No password and no access until the address is confirmed.
  await expect(page.locator("#password-new")).toHaveCount(0);
}

/** Completes Keycloak's authenticator enrollment and returns the secret. */
export async function enrollAuthenticator(page: Page): Promise<string> {
  const secret = await page.locator("#totpSecret").inputValue();
  await page.locator("#totp").fill(totp(secret));
  await page.locator("#saveTOTPBtn").click();
  return secret;
}
