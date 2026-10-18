import type { FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppInstance } from "../../module.js";
import { currentTraceId } from "../../request-context.js";
import {
  SessionFailure,
  type HumanContext,
  type HumanSessionPort,
} from "../identity/public.js";
import { organizationOperations } from "./contracts.js";
import { OrganizationFailure, type Locale } from "./domain.js";
import { respond } from "./errors.js";
import type { BranchRecord, CompanyRecord } from "./prisma-repository.js";
import type { OrganizationService } from "./service.js";

const companyWire = (item: CompanyRecord) => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});
const branchWire = (item: BranchRecord) => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

export function registerOrganizationRoutes(
  app: AppInstance,
  service: OrganizationService,
  sessions: HumanSessionPort,
  limit: { max: number; timeWindow: number } = { max: 120, timeWindow: 60_000 },
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
    for (const operation of organizationOperations) {
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
            branchId?: string;
          };
          const body = (request.body ?? {}) as Record<string, unknown>;
          const query = (request.query ?? {}) as {
            limit?: number;
            cursor?: string;
          };
          const companyId = params.companyId ?? "";
          const branchId = params.branchId ?? "";
          try {
            switch (operation.operationId) {
              case "createCompany": {
                const created = await service.createCompany(
                  context,
                  request.headers["idempotency-key"] as string,
                  {
                    displayName: body.displayName as string,
                    defaultLocale: body.defaultLocale as Locale,
                    timeZone: body.timeZone as string,
                  },
                );
                return reply.code(created.replayed ? 200 : 201).send({
                  company: companyWire(created.company),
                  access: created.access,
                });
              }
              case "listCompanies": {
                const page = await service.listCompanies(context, {
                  limit: query.limit ?? 50,
                  ...(query.cursor ? { cursor: query.cursor } : {}),
                });
                return reply.send({
                  items: page.items.map((item) => ({
                    id: item.id,
                    displayName: item.displayName,
                    status: item.status,
                    roles: item.roles,
                  })),
                  nextCursor: page.nextCursor,
                });
              }
              case "getCompany": {
                const found = await service.getCompany(context, companyId);
                return reply.send({
                  company: companyWire(found.company),
                  access: found.access,
                });
              }
              case "updateCompany": {
                const { expectedVersion, ...changes } = body as {
                  expectedVersion: number;
                  displayName?: string;
                  defaultLocale?: Locale;
                  timeZone?: string;
                };
                return reply.send(
                  companyWire(
                    await service.updateCompany(
                      context,
                      companyId,
                      expectedVersion,
                      changes,
                    ),
                  ),
                );
              }
              case "listBranches": {
                const page = await service.listBranches(context, companyId, {
                  limit: query.limit ?? 50,
                  ...(query.cursor ? { cursor: query.cursor } : {}),
                });
                return reply.send({
                  items: page.items.map(branchWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "createBranch":
                return reply.code(201).send(
                  branchWire(
                    await service.createBranch(context, companyId, {
                      name: body.name as string,
                      ...(body.timeZone === undefined
                        ? {}
                        : { timeZone: body.timeZone as string }),
                    }),
                  ),
                );
              case "getBranch":
                return reply.send(
                  branchWire(
                    await service.getBranch(context, companyId, branchId),
                  ),
                );
              case "updateBranch": {
                const { expectedVersion, ...changes } = body as {
                  expectedVersion: number;
                  name?: string;
                  timeZone?: string;
                };
                return reply.send(
                  branchWire(
                    await service.updateBranch(
                      context,
                      companyId,
                      branchId,
                      expectedVersion,
                      changes,
                    ),
                  ),
                );
              }
              case "archiveBranch":
                return reply.send(
                  branchWire(
                    await service.updateBranch(
                      context,
                      companyId,
                      branchId,
                      body.expectedVersion as number,
                      { archive: true },
                    ),
                  ),
                );
              case "listCompanyAuditEvents": {
                const page = await service.listAuditEvents(context, companyId, {
                  limit: query.limit ?? 50,
                  ...(query.cursor ? { cursor: query.cursor } : {}),
                });
                return reply.send({
                  items: page.items.map((item) => ({
                    ...item,
                    occurredAt: item.occurredAt.toISOString(),
                  })),
                  nextCursor: page.nextCursor,
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
