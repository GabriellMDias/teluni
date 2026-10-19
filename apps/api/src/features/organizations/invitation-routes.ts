import type { FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppInstance } from "../../module.js";
import { currentTraceId } from "../../request-context.js";
import {
  SessionFailure,
  type HumanContext,
  type HumanSessionPort,
} from "../identity/public.js";
import { OrganizationFailure, type AccessRole } from "./domain.js";
import { respond } from "./errors.js";
import { invitationOperations } from "./invitation-contracts.js";
import type {
  InvitationService,
  InvitationView,
} from "./invitation-service.js";

const invitationWire = (item: InvitationView) => ({
  ...item,
  grantExpiresAt: item.grantExpiresAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  expiresAt: item.expiresAt.toISOString(),
});

export function registerInvitationRoutes(
  app: AppInstance,
  service: InvitationService,
  sessions: HumanSessionPort,
  limit: { max: number; timeWindow: number } = { max: 60, timeWindow: 60_000 },
): void {
  const contexts = new WeakMap<FastifyRequest, HumanContext>();
  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure
    ) {
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
    feature.addHook("onSend", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });
    // Every operation authenticates through the identity session boundary.
    feature.addHook("preValidation", async (request, reply) => {
      try {
        contexts.set(
          request,
          await sessions.authenticate({
            method: request.method,
            headers: request.headers,
          }),
        );
      } catch (error) {
        return fail(reply, error, request.id);
      }
    });
    for (const operation of invitationOperations) {
      feature.route({
        method: operation.method,
        url: operation.url,
        schema: operation.schema,
        handler: async (request, reply) => {
          const context = contexts.get(request);
          if (!context)
            return fail(
              reply,
              new SessionFailure("AUTHENTICATION_REQUIRED"),
              request.id,
            );
          const params = (request.params ?? {}) as {
            companyId?: string;
            invitationId?: string;
          };
          const body = (request.body ?? {}) as Record<string, unknown>;
          const query = (request.query ?? {}) as {
            limit?: number;
            cursor?: string;
          };
          const companyId = params.companyId ?? "";
          const invitationId = params.invitationId ?? "";
          try {
            switch (operation.operationId) {
              case "createInvitation":
                return reply.code(201).send(
                  invitationWire(
                    await service.create(
                      context,
                      companyId,
                      body as {
                        email: string;
                        role: AccessRole;
                        scope: "COMPANY" | "BRANCHES";
                        branchIds?: string[];
                        grantExpiresAt?: string;
                      },
                    ),
                  ),
                );
              case "listInvitations": {
                const page = await service.list(context, companyId, {
                  limit: query.limit ?? 50,
                  ...(query.cursor ? { cursor: query.cursor } : {}),
                });
                return reply.send({
                  items: page.items.map(invitationWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "resendInvitation":
                return reply
                  .code(201)
                  .send(
                    invitationWire(
                      await service.resend(context, companyId, invitationId),
                    ),
                  );
              case "revokeInvitation":
                await service.revoke(context, companyId, invitationId);
                return reply.code(204).send();
              case "previewInvitation": {
                const preview = await service.preview(
                  context,
                  body.credential as string,
                );
                return reply.send({
                  ...preview,
                  grantExpiresAt: preview.grantExpiresAt?.toISOString() ?? null,
                  expiresAt: preview.expiresAt.toISOString(),
                });
              }
              case "acceptInvitation": {
                const accepted = await service.accept(
                  context,
                  body.credential as string,
                );
                return reply.code(accepted.replayed ? 200 : 201).send({
                  companyId: accepted.companyId,
                  membershipId: accepted.membershipId,
                });
              }
            }
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
    }
  });
}
