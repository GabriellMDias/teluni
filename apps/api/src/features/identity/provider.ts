import {
  createRemoteJWKSet,
  decodeJwt,
  errors as joseErrors,
  jwtVerify,
} from "jose";
import * as oidc from "openid-client";
import type { HumanIdentitySettings } from "../../module.js";

/** Provider tokens held only on the server, sealed at rest. */
export type ProviderTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  /** Lifetime reported by the provider for the access token. */
  expiresInSeconds: number;
}>;

/** Login facts taken from the ID token verified at the callback. */
export type LoginClaims = Readonly<{
  issuer: string;
  subject: string;
  emailVerified: boolean;
  providerSessionId: string | null;
  assuranceLevel: string;
  authenticatedAt: Date;
}>;

export type LoginChallenge = Readonly<{
  state: string;
  nonce: string;
  codeVerifier: string;
}>;

export type LogoutTokenClaims = Readonly<{
  jti: string;
  subject: string | null;
  providerSessionId: string | null;
}>;

/** The provider rejected a code or refresh grant (`invalid_grant`). */
export class ProviderGrantRejected extends Error {
  constructor() {
    super("Identity provider rejected the grant");
    this.name = "ProviderGrantRejected";
  }
}

/** The provider could not be reached or answered unexpectedly. */
export class ProviderUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Identity provider unavailable", { cause });
    this.name = "ProviderUnavailableError";
  }
}

/** The provider already maps this user to a different application principal. */
export class PrincipalMappingConflict extends Error {
  constructor() {
    super("Provider principal attribute conflicts with the application");
    this.name = "PrincipalMappingConflict";
  }
}

/** The callback or logout token failed protocol validation. */
export class ProviderProtocolError extends Error {
  constructor(cause: unknown) {
    super("Identity protocol validation failed", { cause });
    this.name = "ProviderProtocolError";
  }
}

export interface IdentityProvider {
  newChallenge(): Promise<LoginChallenge & { codeChallenge: string }>;
  authorizationUrl(
    challenge: LoginChallenge & { codeChallenge: string },
  ): Promise<URL>;
  completeLogin(
    callback: URL,
    challenge: LoginChallenge,
  ): Promise<{ tokens: ProviderTokens; claims: LoginClaims }>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
  isActive(accessToken: string): Promise<boolean>;
  endSession(refreshToken: string): Promise<void>;
  endAllSessions(subject: string): Promise<void>;
  ensurePrincipalAttribute(subject: string, principalId: string): Promise<void>;
  verifyLogoutToken(token: string): Promise<LogoutTokenClaims>;
}

export const principalAttribute = "orion_principal_id";
export const callbackPath = "/api/auth/callback";
const logoutEvent = "http://schemas.openid.net/event/backchannel-logout";

function tokensFrom(
  response: oidc.TokenEndpointResponse,
  previousRefreshToken?: string,
): ProviderTokens {
  const refreshToken = response.refresh_token ?? previousRefreshToken;
  if (!refreshToken || typeof response.expires_in !== "number")
    throw new ProviderUnavailableError(
      new Error("Token response lacks refresh token or expiry"),
    );
  return {
    accessToken: response.access_token,
    refreshToken,
    idToken: response.id_token ?? null,
    expiresInSeconds: response.expires_in,
  };
}

function classify(error: unknown): never {
  if (
    error instanceof oidc.ResponseBodyError &&
    error.error === "invalid_grant"
  )
    throw new ProviderGrantRejected();
  if (
    error instanceof oidc.ResponseBodyError ||
    error instanceof oidc.AuthorizationResponseError ||
    error instanceof oidc.ClientError
  ) {
    // Network and timeout failures surface as ClientError with a fetch cause.
    if (
      error instanceof oidc.ClientError &&
      (error.code === "OAUTH_TIMEOUT" ||
        error.cause instanceof TypeError ||
        (error.cause instanceof Error && error.cause.name === "AbortError"))
    )
      throw new ProviderUnavailableError(error);
    if (error instanceof oidc.ResponseBodyError && error.status >= 500)
      throw new ProviderUnavailableError(error);
    throw new ProviderProtocolError(error);
  }
  throw new ProviderUnavailableError(error);
}

/**
 * Keycloak adapter for the accepted provider. The issuer is
 * `<base>/realms/<realm>`; administrative calls use the same realm.
 */
export function createKeycloakProvider(
  settings: HumanIdentitySettings,
): IdentityProvider {
  const issuer = new URL(settings.issuer);
  const insecure = issuer.protocol === "http:";
  const adminBase = settings.issuer.replace("/realms/", "/admin/realms/");
  const redirectUri = `${settings.publicOrigin}${callbackPath}`;
  let web: Promise<oidc.Configuration> | undefined;
  let provisioner: Promise<oidc.Configuration> | undefined;
  let provisionerToken: { value: string; expiresAt: number } | undefined;
  let logoutKeys: ReturnType<typeof createRemoteJWKSet> | undefined;

  async function discover(
    clientId: string,
    secret: string,
  ): Promise<oidc.Configuration> {
    const config = await oidc.discovery(
      issuer,
      clientId,
      undefined,
      oidc.ClientSecretBasic(secret),
      {
        ...(insecure ? { execute: [oidc.allowInsecureRequests] } : {}),
        timeout: 5,
      },
    );
    config.timeout = 5;
    return config;
  }
  async function webConfig(): Promise<oidc.Configuration> {
    web ??= discover(settings.clientId, settings.clientSecret).catch(
      (error: unknown) => {
        web = undefined;
        classify(error);
      },
    );
    return web;
  }
  async function adminToken(): Promise<string> {
    if (provisionerToken && provisionerToken.expiresAt > Date.now() + 30_000)
      return provisionerToken.value;
    provisioner ??= discover(
      settings.provisionerClientId,
      settings.provisionerClientSecret,
    ).catch((error: unknown) => {
      provisioner = undefined;
      classify(error);
    });
    try {
      const response = await oidc.clientCredentialsGrant(await provisioner);
      provisionerToken = {
        value: response.access_token,
        expiresAt: Date.now() + (response.expires_in ?? 60) * 1000,
      };
      return provisionerToken.value;
    } catch (error) {
      classify(error);
    }
  }
  async function admin(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await fetch(`${adminBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await adminToken()}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError(error);
    }
  }

  return {
    async newChallenge() {
      const codeVerifier = oidc.randomPKCECodeVerifier();
      return {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        codeVerifier,
        codeChallenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      };
    },
    async authorizationUrl(challenge) {
      return oidc.buildAuthorizationUrl(await webConfig(), {
        redirect_uri: redirectUri,
        scope: "openid",
        response_type: "code",
        code_challenge: challenge.codeChallenge,
        code_challenge_method: "S256",
        state: challenge.state,
        nonce: challenge.nonce,
      });
    },
    async completeLogin(callback, challenge) {
      const config = await webConfig();
      let response: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
      try {
        response = await oidc.authorizationCodeGrant(config, callback, {
          pkceCodeVerifier: challenge.codeVerifier,
          expectedState: challenge.state,
          expectedNonce: challenge.nonce,
          idTokenExpected: true,
        });
      } catch (error) {
        classify(error);
      }
      const claims = response.claims();
      if (!claims) throw new ProviderProtocolError(new Error("No ID token"));
      const authTime =
        typeof claims.auth_time === "number" ? claims.auth_time : claims.iat;
      return {
        tokens: tokensFrom(response),
        claims: {
          issuer: claims.iss,
          subject: claims.sub,
          emailVerified: claims.email_verified === true,
          providerSessionId: typeof claims.sid === "string" ? claims.sid : null,
          assuranceLevel: typeof claims.acr === "string" ? claims.acr : "",
          authenticatedAt: new Date(authTime * 1000),
        },
      };
    },
    async refresh(refreshToken) {
      try {
        return tokensFrom(
          await oidc.refreshTokenGrant(await webConfig(), refreshToken),
          refreshToken,
        );
      } catch (error) {
        classify(error);
      }
    },
    async isActive(accessToken) {
      try {
        const result = await oidc.tokenIntrospection(
          await webConfig(),
          accessToken,
        );
        return result.active;
      } catch (error) {
        classify(error);
      }
    },
    async endSession(refreshToken) {
      // Keycloak ends the provider session for a confidential client that
      // presents the session's refresh token at the end-session endpoint.
      const config = await webConfig();
      const endpoint = config.serverMetadata().end_session_endpoint;
      if (!endpoint)
        throw new ProviderUnavailableError(new Error("No logout endpoint"));
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(
              `${encodeURIComponent(settings.clientId)}:${encodeURIComponent(settings.clientSecret)}`,
            ).toString("base64")}`,
          },
          body: new URLSearchParams({ refresh_token: refreshToken }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        throw new ProviderUnavailableError(error);
      }
      // An already-ended provider session is the desired outcome.
      if (!response.ok && response.status !== 400)
        throw new ProviderUnavailableError(
          new Error(`Provider logout returned ${response.status}`),
        );
    },
    async endAllSessions(subject) {
      const response = await admin(
        "POST",
        `/users/${encodeURIComponent(subject)}/logout`,
      );
      if (!response.ok && response.status !== 404)
        throw new ProviderUnavailableError(
          new Error(`Provider user logout returned ${response.status}`),
        );
    },
    async ensurePrincipalAttribute(subject, principalId) {
      const path = `/users/${encodeURIComponent(subject)}`;
      const current = await admin("GET", path);
      if (current.status === 404) throw new PrincipalMappingConflict();
      if (!current.ok)
        throw new ProviderUnavailableError(
          new Error(`Provider user lookup returned ${current.status}`),
        );
      const user = (await current.json()) as Record<string, unknown> & {
        attributes?: Record<string, string[]>;
      };
      const existing = user.attributes?.[principalAttribute];
      if (existing?.length) {
        if (existing.length !== 1 || existing[0] !== principalId)
          throw new PrincipalMappingConflict();
        return;
      }
      const updated = await admin("PUT", path, {
        ...user,
        attributes: { ...user.attributes, [principalAttribute]: [principalId] },
      });
      if (!updated.ok)
        throw new ProviderUnavailableError(
          new Error(`Provider principal update returned ${updated.status}`),
        );
    },
    async verifyLogoutToken(token) {
      const config = await webConfig();
      const jwksUri = config.serverMetadata().jwks_uri;
      if (!jwksUri) throw new ProviderUnavailableError(new Error("No JWKS"));
      logoutKeys ??= createRemoteJWKSet(new URL(jwksUri));
      let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
      try {
        ({ payload } = await jwtVerify(token, logoutKeys, {
          issuer: settings.issuer,
          audience: settings.clientId,
          algorithms: ["RS256", "ES256"],
          maxTokenAge: "5m",
          requiredClaims: ["iat", "jti"],
        }));
      } catch (error) {
        if (error instanceof joseErrors.JOSEError)
          throw new ProviderProtocolError(error);
        throw new ProviderUnavailableError(error);
      }
      const events = payload.events as Record<string, unknown> | undefined;
      const subject = typeof payload.sub === "string" ? payload.sub : null;
      const sid = typeof payload.sid === "string" ? payload.sid : null;
      if (
        !events ||
        typeof events[logoutEvent] !== "object" ||
        "nonce" in payload ||
        typeof payload.jti !== "string" ||
        (!subject && !sid)
      )
        throw new ProviderProtocolError(
          new Error("Invalid logout token claims"),
        );
      return { jti: payload.jti, subject, providerSessionId: sid };
    },
  };
}

/** Reads the unverified principal claim only to decide whether to provision it. */
export function provisionedPrincipalClaim(
  accessToken: string,
): string | undefined {
  const value = decodeJwt(accessToken)[principalAttribute];
  return typeof value === "string" ? value : undefined;
}
