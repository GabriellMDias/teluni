import type { Logger } from "pino";
import type { ApiModule } from "../../module.js";
import { cookieNames } from "./domain.js";
import { identityOperations } from "./contracts.js";
import { identityErrors } from "./errors.js";
import { PrismaIdentityRepository } from "./prisma-repository.js";
import { createKeycloakProvider, type IdentityProvider } from "./provider.js";
import type { HumanProfilePort, HumanSessionPort } from "./public.js";
import { registerIdentityRoutes, sessionRequestFrom } from "./routes.js";
import { SessionKeyRing } from "./session-crypto.js";
import { IdentityService } from "./service.js";

/**
 * Composes the identity module and the session port other modules receive.
 * The port is usable once the module activates; modules that use it declare
 * `requiresModules: ["identity"]` so they never activate without it.
 */
export function createIdentityModule(
  options: {
    provider?: IdentityProvider;
    rateLimit?: { max: number; timeWindow: number };
  } = {},
): {
  module: ApiModule;
  sessions: HumanSessionPort;
  profiles: HumanProfilePort;
} {
  let active:
    | {
        service: IdentityService;
        repository: PrismaIdentityRepository;
        names: ReturnType<typeof cookieNames>;
      }
    | undefined;
  let log: Logger | undefined;
  const sessions: HumanSessionPort = {
    async authenticate(request) {
      if (!active) throw new Error("The identity module is not active");
      const context = await active.service.authenticate(
        sessionRequestFrom(request, active.names),
      );
      return {
        principalId: context.principalId,
        sessionId: context.sessionId,
        assuranceLevel: context.assuranceLevel,
        authenticatedAt: context.authenticatedAt,
        strongAuthenticatedAt: context.strongAuthenticatedAt,
        strongAuthenticationAgeSeconds: context.strongAuthenticationAgeSeconds,
        scopes: context.scopes,
      };
    },
  };
  const module: ApiModule = {
    name: "identity",
    tag: "Identity",
    requires: ["database", "authentication", "humanIdentity"],
    operations: identityOperations,
    errors: identityErrors,
    activate: ({ database, verifier, humanIdentity }) => {
      // Activation guarantees every declared requirement is configured.
      const settings = humanIdentity!;
      const repository = new PrismaIdentityRepository(database!);
      const service = new IdentityService({
        repository,
        provider: options.provider ?? createKeycloakProvider(settings),
        verifier: verifier!,
        keys: new SessionKeyRing(settings.sessionKeys),
        publicOrigin: settings.publicOrigin,
        issuer: settings.issuer,
        events: {
          securityEvent: (event) =>
            log?.warn({ securityEvent: event }, "identity_security_event"),
        },
      });
      active = {
        service,
        repository,
        names: cookieNames(settings.publicOrigin.startsWith("https:")),
      };
      return {
        name: "identity",
        register: (app) => {
          log = app.log;
          registerIdentityRoutes(app, service, {
            publicOrigin: settings.publicOrigin,
            ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
          });
        },
      };
    },
  };
  const profiles: HumanProfilePort = {
    getMany(principalIds) {
      if (!active) throw new Error("The identity module is not active");
      return active.repository.readProfiles(principalIds);
    },
  };
  return { module, sessions, profiles };
}
