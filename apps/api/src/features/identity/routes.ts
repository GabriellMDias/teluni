import type { IncomingHttpHeaders } from "node:http";
import { fastifyCookie } from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { FastifyReply } from "fastify";
import type { AppInstance } from "../../module.js";
import { currentTraceId } from "../../request-context.js";
import { cookieNames, LoginFailure, SessionFailure } from "./domain.js";
import { identityOperations } from "./contracts.js";
import { respond } from "./errors.js";
import type { IdentityService, SessionRequest } from "./service.js";

export type CookieNames = ReturnType<typeof cookieNames>;

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Extracts the session boundary's inputs from raw request headers. */
export function sessionRequestFrom(
  request: Readonly<{ method: string; headers: IncomingHttpHeaders }>,
  names: CookieNames,
): SessionRequest {
  const cookies = request.headers.cookie
    ? fastifyCookie.parse(request.headers.cookie)
    : {};
  return {
    sessionToken: cookies[names.session],
    method: request.method,
    origin: header(request.headers.origin),
    csrfToken: header(request.headers["x-csrf-token"]),
    background: header(request.headers["x-teluni-activity"]) === "background",
  };
}

function operation(id: (typeof identityOperations)[number]["operationId"]) {
  const found = identityOperations.find((item) => item.operationId === id);
  if (!found) throw new Error(`Unknown identity operation ${id}`);
  return found;
}

export function registerIdentityRoutes(
  app: AppInstance,
  service: IdentityService,
  options: {
    publicOrigin: string;
    rateLimit?: { max: number; timeWindow: number };
  },
): void {
  const secure = options.publicOrigin.startsWith("https:");
  const names = cookieNames(secure);
  const sessionCookie = {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "strict",
  } as const;
  const loginCookie = {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
  } as const;
  const limit = options.rateLimit ?? { max: 120, timeWindow: 60_000 };

  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (error instanceof SessionFailure) {
      const failure = respond(error.code, requestId, currentTraceId());
      return reply.code(failure.status).send(failure.body);
    }
    throw error;
  }

  void app.register(async (feature) => {
    await feature.register(rateLimit, {
      max: limit.max,
      timeWindow: limit.timeWindow,
      hook: "onRequest",
      addHeadersOnExceeding: {
        "x-ratelimit-limit": false,
        "x-ratelimit-remaining": false,
        "x-ratelimit-reset": false,
      },
      addHeaders: {
        "x-ratelimit-limit": false,
        "x-ratelimit-remaining": false,
        "x-ratelimit-reset": false,
        "retry-after": true,
      },
    });
    await feature.register(fastifyCookie);
    feature.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 32_768 },
      (_request, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      },
    );
    // Authentication responses carry credentials or redirects: never cache
    // them and never leak the callback URL through a referrer.
    feature.addHook("onSend", async (_request, reply) => {
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
    });

    const login = operation("startLogin");
    feature.route({
      method: login.method,
      url: login.url,
      schema: login.schema,
      handler: async (request, reply) => {
        const { returnTo, assurance } = request.query as {
          returnTo?: string;
          assurance?: "strong" | "recent";
        };
        try {
          const started = await service.startLogin(returnTo, assurance);
          reply.setCookie(names.login, started.loginHandle, {
            ...loginCookie,
            maxAge: 600,
          });
          return reply.redirect(started.redirectTo.href, 303);
        } catch (error) {
          return fail(reply, error, request.id);
        }
      },
    });

    const callback = operation("completeLogin");
    feature.route({
      method: callback.method,
      url: callback.url,
      schema: callback.schema,
      handler: async (request, reply) => {
        const { state } = request.query as { state?: string };
        const separator = request.url.indexOf("?");
        reply.clearCookie(names.login, loginCookie);
        try {
          const completed = await service.completeLogin({
            loginHandle: request.cookies[names.login],
            rawQuery: separator < 0 ? "" : request.url.slice(separator + 1),
            state,
            previousSessionToken: request.cookies[names.session],
          });
          reply.setCookie(names.session, completed.sessionToken, sessionCookie);
          return reply.redirect(completed.returnTo, 303);
        } catch (error) {
          if (error instanceof LoginFailure)
            return reply.redirect(`/sign-in?error=${error.reason}`, 303);
          throw error;
        }
      },
    });

    const session = operation("getSession");
    feature.route({
      method: session.method,
      url: session.url,
      schema: session.schema,
      handler: async (request, reply) => {
        try {
          const summary = await service.summary(
            sessionRequestFrom(request, names),
          );
          return reply.send({
            ...summary,
            expiresAt: summary.expiresAt.toISOString(),
            authenticatedAt: summary.authenticatedAt.toISOString(),
            strongAuthenticatedAt:
              summary.strongAuthenticatedAt?.toISOString() ?? null,
          });
        } catch (error) {
          return fail(reply, error, request.id);
        }
      },
    });

    const logout = operation("logout");
    feature.route({
      method: logout.method,
      url: logout.url,
      schema: logout.schema,
      handler: async (request, reply) => {
        try {
          await service.logout(sessionRequestFrom(request, names));
          reply.clearCookie(names.session, sessionCookie);
          return reply.code(204).send();
        } catch (error) {
          return fail(reply, error, request.id);
        }
      },
    });

    const list = operation("listSessions");
    feature.route({
      method: list.method,
      url: list.url,
      schema: list.schema,
      handler: async (request, reply) => {
        try {
          const items = await service.listSessions(
            sessionRequestFrom(request, names),
          );
          return reply.send({
            items: items.map((item) => ({
              ...item,
              createdAt: item.createdAt.toISOString(),
              lastActivityAt: item.lastActivityAt.toISOString(),
              expiresAt: item.expiresAt.toISOString(),
            })),
          });
        } catch (error) {
          return fail(reply, error, request.id);
        }
      },
    });

    const terminate = operation("terminateSession");
    feature.route({
      method: terminate.method,
      url: terminate.url,
      schema: terminate.schema,
      handler: async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
          await service.terminateSession(
            sessionRequestFrom(request, names),
            id,
          );
          return reply.code(204).send();
        } catch (error) {
          return fail(reply, error, request.id);
        }
      },
    });

    const terminateAll = operation("terminateAllSessions");
    feature.route({
      method: terminateAll.method,
      url: terminateAll.url,
      schema: terminateAll.schema,
      handler: async (request, reply) => {
        try {
          await service.terminateAll(sessionRequestFrom(request, names));
          reply.clearCookie(names.session, sessionCookie);
          return reply.code(204).send();
        } catch (error) {
          return fail(reply, error, request.id);
        }
      },
    });

    const backchannel = operation("receiveBackchannelLogout");
    feature.route({
      method: backchannel.method,
      url: backchannel.url,
      schema: backchannel.schema,
      handler: async (request, reply) => {
        const { logout_token: token } = request.body as {
          logout_token: string;
        };
        try {
          if (await service.backchannelLogout(token))
            return reply.code(200).send();
          const failure = respond(
            "VALIDATION_FAILED",
            request.id,
            currentTraceId(),
          );
          return reply.code(failure.status).send(failure.body);
        } catch (error) {
          return fail(reply, error, request.id);
        }
      },
    });
  });
}
