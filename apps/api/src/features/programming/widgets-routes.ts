import rateLimit from "@fastify/rate-limit";
import type { FastifyReply } from "fastify";
import type { AppInstance } from "../../module.js";
import { currentTraceId } from "../../request-context.js";
import { SessionFailure, type HumanSessionPort } from "../identity/public.js";
import { OrganizationFailure } from "../organizations/public.js";
import { ProgrammingFailure } from "./domain.js";
import { respond } from "./errors.js";
import { widgetOperations } from "./widgets-contracts.js";
import type { WidgetService } from "./widgets-service.js";

export function registerWidgetRoutes(
  app: AppInstance,
  service: WidgetService,
  sessions: HumanSessionPort,
): void {
  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (!(
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure ||
      error instanceof ProgrammingFailure
    ))
      throw error;
    const result = respond(
      error.code as Parameters<typeof respond>[0],
      requestId,
      currentTraceId(),
      undefined,
      error instanceof ProgrammingFailure ? error.issues : undefined,
    );
    return reply.code(result.status).send(result.body);
  }
  void app.register(async (feature) => {
    await feature.register(rateLimit, {
      max: 60,
      timeWindow: 60_000,
      hook: "onRequest",
      addHeaders: {
        "x-ratelimit-limit": false,
        "x-ratelimit-remaining": false,
        "x-ratelimit-reset": false,
        "retry-after": true,
      },
    });
    for (const operation of widgetOperations)
      feature.route({
        method: operation.method,
        url: operation.url,
        schema: operation.schema,
        handler: async (request, reply) => {
          reply.header("cache-control", "no-store");
          try {
            if (operation.operationId === "getPublishedQrDestination")
              return reply.send(
                await service.destination(
                  (request.params as { linkId: string }).linkId,
                ),
              );
            const context = await sessions.authenticate({
              method: request.method,
              headers: request.headers,
            });
            const { companyId } = request.params as { companyId: string };
            return reply.send(
              await service.preview(
                context,
                companyId,
                request.body as Parameters<WidgetService["preview"]>[2],
              ),
            );
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
  });
}
