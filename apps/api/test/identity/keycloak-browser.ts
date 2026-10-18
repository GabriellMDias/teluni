import type { KeycloakAdmin } from "../../scripts/keycloak.js";

/** A minimal single-site cookie jar for scripted provider pages. */
export class CookieJar {
  readonly #cookies = new Map<string, string>();

  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(header))
        this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.#cookies.get(name);
  }

  header(): string {
    return [...this.#cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function decodeHtml(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&#61;", "=");
}

/** Extracts the action of the provider's login form from its HTML. */
export function loginFormAction(html: string): string {
  const match = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html);
  if (!match) throw new Error("Keycloak login form not found");
  return decodeHtml(match[1]);
}

/**
 * Drives the real Keycloak login pages for a synthetic user and returns the
 * redirect back to the relying party (the callback URL with code and state).
 */
export async function signInAtProvider(
  authorizationUrl: string,
  credentials: { username: string; password: string },
  jar = new CookieJar(),
): Promise<URL> {
  const page = await fetch(authorizationUrl, {
    redirect: "manual",
    headers: { cookie: jar.header() },
  });
  jar.store(page);
  if (page.status === 302) return new URL(page.headers.get("location")!);
  if (page.status !== 200)
    throw new Error(`Unexpected authorization response ${page.status}`);
  const action = loginFormAction(await page.text());
  const submitted = await fetch(action, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: jar.header(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      username: credentials.username,
      password: credentials.password,
      credentialId: "",
    }),
  });
  jar.store(submitted);
  if (submitted.status !== 302)
    throw new Error(`Provider sign-in did not redirect (${submitted.status})`);
  return new URL(submitted.headers.get("location")!);
}

/** Creates a verified synthetic user through the Admin REST API. */
export async function createSyntheticUser(
  admin: KeycloakAdmin,
  realm: string,
  user: { email: string; password: string },
): Promise<string> {
  const created = await admin.request("POST", `/realms/${realm}/users`, {
    username: user.email,
    email: user.email,
    emailVerified: true,
    enabled: true,
    firstName: "Synthetic",
    lastName: "User",
    credentials: [{ type: "password", value: user.password, temporary: false }],
  });
  if (created.status !== 201)
    throw new Error(`Synthetic user creation failed (${created.status})`);
  return created.headers.get("location")!.split("/").pop()!;
}
