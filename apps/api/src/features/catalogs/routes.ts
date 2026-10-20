import type { FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppInstance } from "../../module.js";
import { currentTraceId } from "../../request-context.js";
import {
  SessionFailure,
  type HumanContext,
  type HumanSessionPort,
} from "../identity/public.js";
import { MediaFailure } from "../media/public.js";
import { OrganizationFailure } from "../organizations/public.js";
import { catalogOperations } from "./contracts.js";
import {
  CatalogFailure,
  type FieldDefinition,
  type FieldInput,
} from "./domain.js";
import { respond } from "./errors.js";
import type {
  CatalogService,
  CatalogView,
  EffectivePricesView,
  PromotionView,
  RecordView,
} from "./service.js";

export type CatalogRouteLimits = Readonly<{
  /** Requests per client address and window. */
  requests: { max: number; timeWindow: number };
}>;

const defaultLimits: CatalogRouteLimits = {
  requests: { max: 300, timeWindow: 60_000 },
};

const quietHeaders = {
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
} as const;

const fieldWire = (field: FieldDefinition) => ({
  id: field.id,
  label: field.label,
  type: field.type,
  required: field.required,
  archived: field.archived,
  ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
  ...(field.decimals !== undefined
    ? {
        decimals: field.decimals,
        minimum: field.minimum ?? null,
        maximum: field.maximum ?? null,
      }
    : {}),
  ...(field.choices !== undefined
    ? { choices: field.choices.map((choice) => ({ ...choice })) }
    : {}),
  ...(field.currency !== undefined
    ? { currency: field.currency, promotions: field.promotions ?? true }
    : {}),
  ...(field.targetCatalogId !== undefined
    ? { targetCatalogId: field.targetCatalogId }
    : {}),
});

const catalogWire = (item: CatalogView) => ({
  id: item.id,
  name: item.name,
  branch: item.branchId
    ? { id: item.branchId, name: item.branchName ?? "" }
    : null,
  status: item.status,
  fields: item.fields.map(fieldWire),
  recordCount: item.recordCount,
  schemaVersion: item.schemaVersion,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  version: item.version,
});

const recordWire = (item: RecordView) => ({
  id: item.id,
  catalogId: item.catalogId,
  title: item.title,
  available: item.available,
  values: item.values,
  overrides: item.overrides.map((override) => ({
    fieldId: override.fieldId,
    branch: { id: override.branchId, name: override.branchName },
    amount: override.amount,
  })),
  media: item.media.map((entry) => ({ ...entry })),
  references: item.references.map((entry) => ({ ...entry })),
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  version: item.version,
});

const promotionWire = (item: PromotionView) => ({
  id: item.id,
  fieldId: item.fieldId,
  branch: item.branchId
    ? { id: item.branchId, name: item.branchName ?? "" }
    : null,
  amount: item.amount,
  startsAt: item.startsAt,
  endsAt: item.endsAt,
  createdAt: item.createdAt.toISOString(),
});

const effectiveWire = (view: EffectivePricesView) => ({
  at: view.at,
  fields: view.fields.map((entry) => ({
    fieldId: entry.fieldId,
    currency: entry.currency,
    scope: { ...entry.scope },
    branches: entry.branches.map((branch) => ({
      branch: { id: branch.branchId, name: branch.branchName },
      amount: branch.amount,
      source: branch.source,
      promotionId: branch.promotionId,
    })),
  })),
});

export function registerCatalogRoutes(
  app: AppInstance,
  service: CatalogService,
  sessions: HumanSessionPort,
  limits: CatalogRouteLimits = defaultLimits,
): void {
  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure ||
      error instanceof CatalogFailure ||
      error instanceof MediaFailure
    ) {
      const failure = respond(
        error.code as Parameters<typeof respond>[0],
        requestId,
        currentTraceId(),
        undefined,
        error instanceof CatalogFailure ? error.issues : undefined,
      );
      if (error.code === "RATE_LIMITED") reply.header("retry-after", "60");
      return reply.code(failure.status).send(failure.body);
    }
    throw error;
  }

  void app.register(async (feature) => {
    await feature.register(rateLimit, {
      ...limits.requests,
      hook: "onRequest",
      ...quietHeaders,
    });
    const contexts = new WeakMap<FastifyRequest, HumanContext>();
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
    for (const operation of catalogOperations) {
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
          reply.header("cache-control", "no-store");
          const params = request.params as {
            companyId: string;
            catalogId?: string;
            recordId?: string;
            fieldId?: string;
            branchId?: string;
            promotionId?: string;
          };
          const companyId = params.companyId;
          const catalogId = params.catalogId ?? "";
          const recordId = params.recordId ?? "";
          const fieldId = params.fieldId ?? "";
          const body = (request.body ?? {}) as Record<string, unknown>;
          const expectedVersion = body.expectedVersion as number;
          try {
            switch (operation.operationId) {
              case "listCatalogs": {
                const query = request.query as {
                  limit?: number;
                  cursor?: string;
                  scope?: string;
                  text?: string;
                  status?: "ACTIVE" | "ARCHIVED";
                };
                const page = await service.listCatalogs(context, companyId, {
                  ...query,
                  limit: query.limit ?? 50,
                });
                return reply.send({
                  items: page.items.map(catalogWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "createCatalog":
                return reply.code(201).send(
                  catalogWire(
                    await service.createCatalog(
                      context,
                      companyId,
                      body as {
                        name: string;
                        branchId: string | null;
                        fields?: FieldInput[];
                      },
                    ),
                  ),
                );
              case "getCatalog":
                return reply.send(
                  catalogWire(
                    await service.getCatalog(context, companyId, catalogId),
                  ),
                );
              case "updateCatalog":
                return reply.send(
                  catalogWire(
                    await service.updateCatalog(
                      context,
                      companyId,
                      catalogId,
                      expectedVersion,
                      body,
                    ),
                  ),
                );
              case "deleteCatalog":
                await service.deleteCatalog(
                  context,
                  companyId,
                  catalogId,
                  expectedVersion,
                );
                return reply.code(204).send();
              case "replaceCatalogSchema":
                return reply.send(
                  catalogWire(
                    await service.replaceSchema(
                      context,
                      companyId,
                      catalogId,
                      expectedVersion,
                      body.fields as FieldInput[],
                    ),
                  ),
                );
              case "listCatalogRecords": {
                const query = request.query as {
                  limit?: number;
                  cursor?: string;
                  text?: string;
                };
                const page = await service.listRecords(
                  context,
                  companyId,
                  catalogId,
                  { ...query, limit: query.limit ?? 50 },
                );
                return reply.send({
                  items: page.items.map(recordWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "createCatalogRecord":
                return reply.code(201).send(
                  recordWire(
                    await service.createRecord(
                      context,
                      companyId,
                      catalogId,
                      body as {
                        values: Record<string, unknown>;
                        available?: boolean;
                      },
                    ),
                  ),
                );
              case "getCatalogRecord":
                return reply.send(
                  recordWire(
                    await service.getRecord(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                    ),
                  ),
                );
              case "updateCatalogRecord":
                return reply.send(
                  recordWire(
                    await service.updateRecord(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                      expectedVersion,
                      body,
                    ),
                  ),
                );
              case "moveCatalogRecord":
                return reply.send(
                  recordWire(
                    await service.moveRecord(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                      expectedVersion,
                      body.afterRecordId as string | null,
                    ),
                  ),
                );
              case "deleteCatalogRecord":
                await service.deleteRecord(
                  context,
                  companyId,
                  catalogId,
                  recordId,
                  expectedVersion,
                );
                return reply.code(204).send();
              case "setCatalogBasePrice":
                return reply.send(
                  recordWire(
                    await service.setBasePrice(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                      fieldId,
                      expectedVersion,
                      body.amount as number | null,
                    ),
                  ),
                );
              case "setCatalogBranchPrice":
                return reply.send(
                  recordWire(
                    await service.setBranchPrice(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                      fieldId,
                      params.branchId ?? "",
                      expectedVersion,
                      body.amount as number | null,
                    ),
                  ),
                );
              case "listCatalogPromotions":
                return reply.send({
                  items: (
                    await service.listPromotions(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                      fieldId,
                    )
                  ).map(promotionWire),
                });
              case "createCatalogPromotion":
                return reply.code(201).send(
                  promotionWire(
                    await service.createPromotion(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                      fieldId,
                      body as {
                        branchId: string | null;
                        amount: number;
                        startsAt: string;
                        endsAt: string;
                      },
                    ),
                  ),
                );
              case "deleteCatalogPromotion":
                await service.deletePromotion(
                  context,
                  companyId,
                  catalogId,
                  recordId,
                  fieldId,
                  params.promotionId ?? "",
                );
                return reply.code(204).send();
              case "getCatalogEffectivePrices":
                return reply.send(
                  effectiveWire(
                    await service.effectivePrices(
                      context,
                      companyId,
                      catalogId,
                      recordId,
                      (request.query as { at: string }).at,
                    ),
                  ),
                );
            }
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
    }
  });
}
