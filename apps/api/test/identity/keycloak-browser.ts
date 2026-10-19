import { createHmac } from "node:crypto";
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

// Decode `&amp;` last so an escaped entity such as `&amp;#61;` stays literal.
function decodeHtml(value: string): string {
  return value.replaceAll("&#61;", "=").replaceAll("&amp;", "&");
}

/** Extracts the action of a provider form, identified by its id, from HTML. */
export function formAction(html: string, id: string): string | undefined {
  const tag = new RegExp(`<form[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  const action = tag && /\baction="([^"]+)"/.exec(tag)?.[1];
  return action ? decodeHtml(action) : undefined;
}

export function loginFormAction(html: string): string {
  const action = formAction(html, "kc-form-login");
  if (!action) throw new Error("Keycloak login form not found");
  return action;
}

/** A synthetic authenticator app: RFC 6238 TOTP, SHA-1, six digits, 30 s. */
export class SyntheticAuthenticator {
  secret: string | undefined;
  #lastCounter = -1;

  async code(): Promise<string> {
    if (!this.secret) throw new Error("No OTP secret enrolled");
    let counter = Math.floor(Date.now() / 30_000);
    // Keycloak rejects reuse of a code within its period by default.
    if (counter === this.#lastCounter) {
      await new Promise((resolve) =>
        setTimeout(resolve, (counter + 1) * 30_000 - Date.now() + 50),
      );
      counter = Math.floor(Date.now() / 30_000);
    }
    this.#lastCounter = counter;
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", Buffer.from(this.secret, "utf8"))
      .update(message)
      .digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return value.toString().padStart(6, "0");
  }
}

async function postForm(
  action: string,
  fields: Record<string, string>,
  jar: CookieJar,
): Promise<Response> {
  const response = await fetch(action, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: jar.header(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  });
  jar.store(response);
  return response;
}

/**
 * Drives the real Keycloak pages for a synthetic user, enrolling or using a
 * synthetic OTP authenticator when the flow asks for one, and returns the
 * redirect back to the relying party (the callback URL with code and state).
 */
export async function signInAtProvider(
  authorizationUrl: string,
  credentials: { username: string; password: string },
  jar = new CookieJar(),
  authenticator?: SyntheticAuthenticator,
): Promise<URL> {
  let response = await fetch(authorizationUrl, {
    redirect: "manual",
    headers: { cookie: jar.header() },
  });
  jar.store(response);
  const provider = new URL(authorizationUrl).origin;
  for (let step = 0; step < 8; step += 1) {
    if (response.status === 302) {
      const location = new URL(
        response.headers.get("location")!,
        authorizationUrl,
      );
      // Required actions redirect to the provider's own login actions; any
      // other destination is the relying party's redirect and ends sign-in.
      if (
        location.origin !== provider ||
        !location.pathname.includes("/login-actions/")
      )
        return location;
      response = await fetch(location, {
        redirect: "manual",
        headers: { cookie: jar.header() },
      });
      jar.store(response);
      continue;
    }
    if (response.status !== 200)
      throw new Error(`Unexpected provider response ${response.status}`);
    const html = await response.text();
    const login = formAction(html, "kc-form-login");
    const enroll = formAction(html, "kc-totp-settings-form");
    const otp = formAction(html, "kc-otp-login-form");
    if (login)
      response = await postForm(
        login,
        {
          username: credentials.username,
          password: credentials.password,
          credentialId: "",
        },
        jar,
      );
    else if (enroll && authenticator) {
      authenticator.secret = decodeHtml(
        /id="totpSecret"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? "",
      );
      response = await postForm(
        enroll,
        {
          totp: await authenticator.code(),
          totpSecret: authenticator.secret,
          userLabel: "Synthetic authenticator",
        },
        jar,
      );
    } else if (otp && authenticator)
      response = await postForm(otp, { otp: await authenticator.code() }, jar);
    else throw new Error("Unexpected provider page");
  }
  throw new Error("Provider sign-in did not finish");
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
