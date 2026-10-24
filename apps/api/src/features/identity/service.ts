import { randomUUID } from "node:crypto";
import type { AccessTokenVerifier } from "../../authentication.js";
import {
  assuranceLevels,
  isUnsafeMethod,
  LoginFailure,
  recentStrongAuthenticationSeconds,
  safeReturnPath,
  SessionFailure,
  sessionPolicy,
  type HumanContext,
  type RequestedAssurance,
  type RevocationReason,
} from "./domain.js";
import type {
  PrismaIdentityRepository,
  StoredSession,
} from "./prisma-repository.js";
import {
  callbackPath,
  PrincipalMappingConflict,
  ProviderGrantRejected,
  ProviderProtocolError,
  ProviderUnavailableError,
  provisionedPrincipalClaim,
  type IdentityProvider,
  type ProviderTokens,
} from "./provider.js";
import {
  hashSecret,
  newSecret,
  type SessionKeyRing,
} from "./session-crypto.js";

/** Transport-independent facts the session boundary needs from a request. */
export type SessionRequest = Readonly<{
  sessionToken: string | undefined;
  method: string;
  origin: string | undefined;
  csrfToken: string | undefined;
  /** Polling and other automatic requests do not extend idle lifetime. */
  background: boolean;
}>;

/** Security events the service reports through the module's logger. */
export type IdentityEvents = Readonly<{
  securityEvent(
    event:
      | "principal_mapping_conflict"
      | "principal_token_mismatch"
      | "provider_logout_failed"
      | "logout_token_rejected",
  ): void;
}>;

export type SessionSummary = Readonly<{
  principalId: string;
  sessionId: string;
  state: "ACTIVE" | "PENDING_LIMIT";
  expiresAt: Date;
  assuranceLevel: string;
  authenticatedAt: Date;
  strongAuthenticatedAt: Date | null;
  csrfToken: string;
}>;

export type SessionListItem = Readonly<{
  id: string;
  state: "ACTIVE" | "PENDING_LIMIT";
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  current: boolean;
}>;

type SealedTokens = {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
};

const leaseWaitMs = 3000;
const leasePollMs = 100;

function presentationText(
  value: string | undefined,
  maxLength: number,
): string | null {
  const text = value?.trim();
  return text &&
    text.length <= maxLength &&
    [...text].every(
      (character) =>
        character.codePointAt(0)! >= 32 && character.codePointAt(0)! !== 127,
    )
    ? text
    : null;
}

export class IdentityService {
  readonly #repository: PrismaIdentityRepository;
  readonly #provider: IdentityProvider;
  readonly #verifier: AccessTokenVerifier;
  readonly #keys: SessionKeyRing;
  readonly #publicOrigin: string;
  readonly #issuer: string;
  readonly #events: IdentityEvents;
  readonly #developmentMfaBypass: boolean;

  constructor(options: {
    repository: PrismaIdentityRepository;
    provider: IdentityProvider;
    verifier: AccessTokenVerifier;
    keys: SessionKeyRing;
    publicOrigin: string;
    /** Issuer whose subjects this service manages. */
    issuer: string;
    events: IdentityEvents;
    /** Only the module's guarded local-development mode may enable this. */
    developmentMfaBypass?: boolean;
  }) {
    this.#repository = options.repository;
    this.#provider = options.provider;
    this.#verifier = options.verifier;
    this.#keys = options.keys;
    this.#publicOrigin = options.publicOrigin;
    this.#issuer = options.issuer;
    this.#events = options.events;
    this.#developmentMfaBypass = options.developmentMfaBypass ?? false;
  }

  /**
   * Starts an authorization-code login; the handle goes into the
   * login-attempt cookie. A signup opens the provider's account creation,
   * which verifies the email before the person returns.
   */
  async startLogin(
    returnTo: string | undefined,
    assurance?: RequestedAssurance,
    intent?: "signup",
  ): Promise<{ redirectTo: URL; loginHandle: string }> {
    // Step-up asks for the strong level; "recent" also forces a new
    // authentication so the strong factor is at most five minutes old.
    const requestedAssurance =
      assurance && !this.#developmentMfaBypass ? assuranceLevels.strong : null;
    const maxAgeSeconds =
      assurance === "recent" && !this.#developmentMfaBypass ? 0 : null;
    const challenge = await this.#unavailableAs503(() =>
      this.#provider.newChallenge(),
    );
    const id = randomUUID();
    const loginHandle = newSecret();
    // Retention upkeep rides on sign-in starts, which are rare and bounded.
    await this.#repository.purgeEnded();
    await this.#repository.createLoginAttempt({
      id,
      handleHash: hashSecret(loginHandle),
      state: challenge.state,
      secrets: this.#keys.seal(
        JSON.stringify({
          codeVerifier: challenge.codeVerifier,
          nonce: challenge.nonce,
        }),
        `login:${id}`,
      ),
      returnTo: safeReturnPath(returnTo),
      requestedAssurance,
      maxAgeSeconds,
    });
    const redirectTo = await this.#unavailableAs503(() =>
      this.#provider.authorizationUrl(challenge, {
        ...(requestedAssurance ? { acrValues: requestedAssurance } : {}),
        ...(maxAgeSeconds === null ? {} : { maxAgeSeconds }),
        ...(intent === "signup" ? { prompt: "create" as const } : {}),
      }),
    );
    return { redirectTo, loginHandle };
  }

  /**
   * Completes the callback: consumes the attempt, provisions the application
   * principal and creates a session. Throws LoginFailure for browser-safe outcomes.
   */
  async completeLogin(input: {
    loginHandle: string | undefined;
    rawQuery: string;
    state: string | undefined;
    previousSessionToken: string | undefined;
  }): Promise<{ sessionToken: string; returnTo: string; pending: boolean }> {
    if (!input.loginHandle || !input.state)
      throw new LoginFailure("login_expired");
    const attempt = await this.#repository.consumeLoginAttempt(
      hashSecret(input.loginHandle),
      input.state,
    );
    if (!attempt) throw new LoginFailure("login_expired");
    const { codeVerifier, nonce } = JSON.parse(
      this.#keys.open(attempt.secrets, `login:${attempt.id}`),
    ) as { codeVerifier: string; nonce: string };
    const callback = new URL(
      `${this.#publicOrigin}${callbackPath}?${input.rawQuery}`,
    );

    let login: Awaited<ReturnType<IdentityProvider["completeLogin"]>>;
    try {
      login = await this.#provider.completeLogin(callback, {
        state: attempt.state,
        nonce,
        codeVerifier,
      });
    } catch (error) {
      throw this.#loginFailure(error, "login_failed");
    }
    const { claims } = login;
    let { tokens } = login;
    if (!claims.emailVerified) throw new LoginFailure("email_unverified");
    const strong = claims.assuranceLevel === assuranceLevels.strong;
    // The provider may answer a step-up request with a lower level; the
    // application never treats that as strong authentication.
    if (
      attempt.requestedAssurance &&
      claims.assuranceLevel !== attempt.requestedAssurance
    )
      throw new LoginFailure("assurance_not_met");
    if (
      attempt.maxAgeSeconds !== null &&
      Date.now() - claims.authenticatedAt.getTime() >
        (attempt.maxAgeSeconds + recentStrongAuthenticationSeconds) * 1000
    )
      throw new LoginFailure("assurance_not_met");

    const principal = await this.#repository.findOrCreatePrincipal(
      claims.issuer,
      claims.subject,
      randomUUID(),
    );
    if (!principal.active) throw new LoginFailure("account_unavailable");
    const asserted = provisionedPrincipalClaim(tokens.accessToken);
    if (asserted !== principal.id) {
      if (asserted !== undefined) {
        this.#events.securityEvent("principal_mapping_conflict");
        throw new LoginFailure("account_unavailable");
      }
      try {
        await this.#provider.ensurePrincipalAttribute(
          claims.subject,
          principal.id,
        );
        tokens = await this.#provider.refresh(tokens.refreshToken);
      } catch (error) {
        if (error instanceof PrincipalMappingConflict)
          this.#events.securityEvent("principal_mapping_conflict");
        throw this.#loginFailure(error, "account_unavailable");
      }
    }
    // The unchanged ADR-0012 verifier is the authority for the access token.
    const verified = await this.#verifier.verify(
      `Bearer ${tokens.accessToken}`,
    );
    if (!verified || verified.id !== principal.id) {
      this.#events.securityEvent("principal_token_mismatch");
      throw new LoginFailure("account_unavailable");
    }

    // A new login always mints a new credential and retires the previous one.
    if (input.previousSessionToken) {
      const previous = await this.#repository.findSession({
        tokenHash: hashSecret(input.previousSessionToken),
      });
      if (previous) await this.#repository.revoke(previous.id, "REPLACED");
    }
    const id = randomUUID();
    const sessionToken = newSecret();
    const state = await this.#repository.createSession({
      id,
      principalId: principal.id,
      profile: {
        displayName: presentationText(claims.displayName, 200),
        email: presentationText(claims.email, 320),
      },
      tokenHash: hashSecret(sessionToken),
      providerSessionId: claims.providerSessionId,
      assuranceLevel: claims.assuranceLevel,
      authenticatedAt: claims.authenticatedAt,
      strongAuthenticatedAt: strong ? claims.authenticatedAt : null,
      // Per-membership idle limits remain pending; use the stricter bound.
      idleTimeoutSeconds: sessionPolicy.administrativeIdleSeconds,
      providerTokens: this.#seal(id, tokens),
      accessTokenLifetimeSeconds: tokens.expiresInSeconds,
    });
    return {
      sessionToken,
      returnTo: attempt.returnTo,
      pending: state === "PENDING_LIMIT",
    };
  }

  /**
   * The session boundary used by every module that needs a human. It denies
   * revoked, expired, cross-site and provider-ended sessions, revalidates the
   * provider within 30 seconds and verifies the stored access token.
   */
  async authenticate(
    request: SessionRequest,
    options: { allowPending?: boolean } = {},
  ): Promise<HumanContext & { pending: boolean }> {
    if (!request.sessionToken)
      throw new SessionFailure("AUTHENTICATION_REQUIRED");
    let session = await this.#repository.findSession({
      tokenHash: hashSecret(request.sessionToken),
    });
    if (!session || session.state === "REVOKED")
      throw new SessionFailure("AUTHENTICATION_REQUIRED");
    if (session.expired) return this.#deny(session, "EXPIRED");
    if (!session.principalActive)
      return this.#deny(session, "PRINCIPAL_DISABLED");
    if (
      isUnsafeMethod(request.method) &&
      (request.origin !== this.#publicOrigin ||
        !this.#keys.verifyCsrf(session.id, request.csrfToken))
    )
      throw new SessionFailure("CSRF_VALIDATION_FAILED");
    let pending = session.state === "PENDING_LIMIT";
    if (
      pending &&
      (await this.#repository.activatePending(session.id, session.principalId))
    )
      pending = false;
    if (pending && !options.allowPending)
      throw new SessionFailure("SESSION_LIMIT_REACHED");

    let tokens = this.#open(session);
    if (session.refreshDue) {
      ({ session, tokens } = await this.#refresh(session, tokens));
    } else if (session.recheckDue) {
      const active = await this.#unavailableAs503(() =>
        this.#provider.isActive(tokens.accessToken),
      );
      if (!active) return this.#deny(session, "PROVIDER_INACTIVE");
      await this.#repository.markProviderChecked(session.id);
    }
    const verified = await this.#verifier.verify(
      `Bearer ${tokens.accessToken}`,
    );
    if (!verified || verified.id !== session.principalId) {
      this.#events.securityEvent("principal_token_mismatch");
      return this.#deny(session, "PRINCIPAL_MISMATCH");
    }
    if (!request.background && session.activityDue)
      await this.#repository.recordActivity(session.id);
    return {
      principalId: session.principalId,
      sessionId: session.id,
      // Local development simulates effective assurance only after every real
      // identity/session check. Never persist it or label it provider AAL2.
      assuranceLevel: this.#developmentMfaBypass
        ? "teluni-development"
        : session.assuranceLevel,
      authenticatedAt: session.authenticatedAt,
      strongAuthenticatedAt: this.#developmentMfaBypass
        ? new Date()
        : session.strongAuthenticatedAt,
      strongAuthenticationAgeSeconds: this.#developmentMfaBypass
        ? 0
        : session.strongAuthenticationAgeSeconds,
      scopes: verified.scopes,
      pending,
    };
  }

  async summary(request: SessionRequest): Promise<SessionSummary> {
    const context = await this.authenticate(request, { allowPending: true });
    const session = await this.#repository.findSession({
      id: context.sessionId,
    });
    if (!session) throw new SessionFailure("AUTHENTICATION_REQUIRED");
    return {
      principalId: context.principalId,
      sessionId: context.sessionId,
      state: context.pending ? "PENDING_LIMIT" : "ACTIVE",
      expiresAt: session.expiresAt,
      assuranceLevel: context.assuranceLevel,
      authenticatedAt: context.authenticatedAt,
      strongAuthenticatedAt: context.strongAuthenticatedAt,
      csrfToken: this.#keys.csrfToken(context.sessionId),
    };
  }

  async listSessions(request: SessionRequest): Promise<SessionListItem[]> {
    const context = await this.authenticate(request, { allowPending: true });
    const sessions = await this.#repository.listSessions(context.principalId);
    return sessions.map((session) => ({
      id: session.id,
      state: session.state === "PENDING_LIMIT" ? "PENDING_LIMIT" : "ACTIVE",
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      current: session.id === context.sessionId,
    }));
  }

  /** Ends the current session here and at the provider. */
  async logout(request: SessionRequest): Promise<void> {
    const context = await this.authenticate(request, { allowPending: true });
    await this.#terminate(context.principalId, context.sessionId, "LOGOUT");
  }

  /** Ends one of the caller's sessions; another principal's session is not found. */
  async terminateSession(
    request: SessionRequest,
    sessionId: string,
  ): Promise<void> {
    const context = await this.authenticate(request, { allowPending: true });
    if (
      !(await this.#terminate(
        context.principalId,
        sessionId,
        "TERMINATED_BY_USER",
      ))
    )
      throw new SessionFailure("RESOURCE_NOT_FOUND");
  }

  /** Ends every session of the caller, including provider sessions elsewhere. */
  async terminateAll(request: SessionRequest): Promise<void> {
    const context = await this.authenticate(request, { allowPending: true });
    const session = await this.#repository.findSession({
      id: context.sessionId,
    });
    await this.#repository.revokePrincipal(
      context.principalId,
      "TERMINATED_BY_USER",
    );
    if (!session) return;
    try {
      await this.#provider.endAllSessions(session.subject);
    } catch {
      this.#events.securityEvent("provider_logout_failed");
    }
  }

  /** Applies a provider back-channel logout token; returns false when it is invalid. */
  async backchannelLogout(logoutToken: string): Promise<boolean> {
    let claims: Awaited<ReturnType<IdentityProvider["verifyLogoutToken"]>>;
    try {
      claims = await this.#provider.verifyLogoutToken(logoutToken);
    } catch (error) {
      if (error instanceof ProviderUnavailableError)
        throw new SessionFailure("SERVICE_UNAVAILABLE");
      this.#events.securityEvent("logout_token_rejected");
      return false;
    }
    if (!(await this.#repository.rememberLogoutToken(claims.jti))) {
      this.#events.securityEvent("logout_token_rejected");
      return false;
    }
    if (claims.providerSessionId)
      await this.#repository.revokeProviderSession(
        this.#issuer,
        claims.providerSessionId,
      );
    else if (claims.subject)
      await this.#repository.revokeProviderSubject(
        this.#issuer,
        claims.subject,
      );
    return true;
  }

  async #terminate(
    principalId: string,
    sessionId: string,
    reason: RevocationReason,
  ): Promise<boolean> {
    const sealed = await this.#repository.revokeOwned(
      principalId,
      sessionId,
      reason,
    );
    if (!sealed) return false;
    try {
      const tokens = JSON.parse(
        this.#keys.open(sealed, `session:${sessionId}`),
      ) as SealedTokens;
      await this.#provider.endSession(tokens.refreshToken);
    } catch {
      // The application session is already revoked; the provider session expires on its own.
      this.#events.securityEvent("provider_logout_failed");
    }
    return true;
  }

  async #refresh(
    session: StoredSession,
    tokens: SealedTokens,
  ): Promise<{ session: StoredSession; tokens: SealedTokens }> {
    if (await this.#repository.acquireRefreshLease(session.id)) {
      // Re-read under the lease: an earlier winner may have rotated the
      // tokens after this request loaded the row. Reusing the stale refresh
      // token would make the provider revoke the whole session.
      const fresh = await this.#repository.findSession({ id: session.id });
      if (!fresh || fresh.state === "REVOKED")
        throw new SessionFailure("AUTHENTICATION_REQUIRED");
      if (!fresh.refreshDue) {
        await this.#repository.releaseRefreshLease(session.id);
        return { session: fresh, tokens: this.#open(fresh) };
      }
      tokens = this.#open(fresh);
      let refreshed: ProviderTokens;
      try {
        refreshed = await this.#provider.refresh(tokens.refreshToken);
      } catch (error) {
        if (error instanceof ProviderGrantRejected)
          return this.#deny(session, "REFRESH_REJECTED");
        await this.#repository.releaseRefreshLease(session.id);
        throw new SessionFailure("SERVICE_UNAVAILABLE");
      }
      if (
        !(await this.#repository.storeRefreshedTokens(
          session.id,
          this.#seal(session.id, refreshed),
          refreshed.expiresInSeconds,
        ))
      )
        throw new SessionFailure("AUTHENTICATION_REQUIRED");
      return {
        session,
        tokens: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          idToken: refreshed.idToken,
        },
      };
    }
    // Another request is refreshing: wait for its result instead of racing it.
    const deadline = Date.now() + leaseWaitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, leasePollMs));
      const current = await this.#repository.findSession({ id: session.id });
      if (!current || current.state === "REVOKED")
        throw new SessionFailure("AUTHENTICATION_REQUIRED");
      if (!current.refreshDue)
        return { session: current, tokens: this.#open(current) };
    }
    throw new SessionFailure("SERVICE_UNAVAILABLE");
  }

  async #deny(
    session: StoredSession,
    reason: RevocationReason,
  ): Promise<never> {
    await this.#repository.revoke(session.id, reason);
    throw new SessionFailure("AUTHENTICATION_REQUIRED");
  }

  #seal(sessionId: string, tokens: ProviderTokens): Buffer {
    return this.#keys.seal(
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        idToken: tokens.idToken,
      } satisfies SealedTokens),
      `session:${sessionId}`,
    );
  }

  #open(session: StoredSession): SealedTokens {
    return JSON.parse(
      this.#keys.open(session.providerTokens, `session:${session.id}`),
    ) as SealedTokens;
  }

  #loginFailure(
    error: unknown,
    fallback: "login_failed" | "account_unavailable",
  ): LoginFailure {
    if (error instanceof LoginFailure) return error;
    if (error instanceof ProviderUnavailableError)
      return new LoginFailure("provider_unavailable");
    if (error instanceof ProviderGrantRejected)
      return new LoginFailure("login_expired");
    if (error instanceof ProviderProtocolError)
      return new LoginFailure("login_failed");
    if (error instanceof PrincipalMappingConflict)
      return new LoginFailure("account_unavailable");
    return new LoginFailure(fallback);
  }

  async #unavailableAs503<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof ProviderUnavailableError ||
        error instanceof ProviderProtocolError
      )
        throw new SessionFailure("SERVICE_UNAVAILABLE");
      throw error;
    }
  }
}
