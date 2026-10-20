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
import { ProgrammingFailure } from "./domain.js";
import { respond } from "./errors.js";
import { layoutOperations } from "./layouts-contracts.js";
import type { LayoutDocument, LayoutInput } from "./layouts.js";
import {
  canvasOf,
  type LayoutService,
  type LayoutSummary,
  type LayoutView,
} from "./layouts-service.js";
import type { ProgrammingRouteLimits } from "./routes.js";

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

const branchWire = (item: {
  branchId: string | null;
  branchName: string | null;
}) =>
  item.branchId ? { id: item.branchId, name: item.branchName ?? "" } : null;

const summaryWire = (item: LayoutSummary) => ({
  id: item.id,
  name: item.name,
  branch: branchWire(item),
  orientation: item.orientation,
  areaCount: item.areaCount,
  pageCount: item.pageCount,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  version: item.version,
});

const layoutWire = (item: LayoutView) => ({
  id: item.id,
  name: item.name,
  branch: branchWire(item),
  orientation: item.orientation,
  canvas: { ...canvasOf(item) },
  audioMixConfirmed: item.definition.audioMixConfirmed,
  areas: item.definition.areas.map((area) => {
    const catalog = area.view
      ? item.catalogs.get(area.view.catalogId)
      : undefined;
    const fields = new Map(catalog?.fields.map((field) => [field.id, field]));
    return {
      key: area.key,
      name: area.name,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      z: area.z,
      background: area.background,
      fit: area.fit,
      muted: area.muted,
      volume: area.volume,
      kind: area.kind,
      pageControlled: area.pageControlled,
      view: area.view
        ? {
            catalog: { id: area.view.catalogId, name: catalog?.name ?? "" },
            fields: area.view.fields.map((field) => ({
              fieldId: field.fieldId,
              role: field.role,
              label: fields.get(field.fieldId)?.label ?? null,
              type: fields.get(field.fieldId)?.type ?? null,
            })),
            presentation: area.view.presentation,
            textSize: area.view.textSize,
            unavailable: area.view.unavailable,
            pageSeconds: area.view.pageSeconds,
          }
        : null,
    };
  }),
  pages: item.definition.pages.map((page, index) => ({
    durationSeconds: page.durationSeconds,
    suggestedSeconds: item.suggestedSeconds[index] ?? null,
    contents: page.contents.map((content) => {
      const media = content.mediaAssetId
        ? item.media.get(content.mediaAssetId)
        : undefined;
      return {
        areaKey: content.areaKey,
        mediaAssetId: content.mediaAssetId,
        media: media ? { ...media } : null,
        viewPage: content.viewPage,
        groupChoiceId: content.groupChoiceId,
      };
    }),
  })),
  fit: item.fit.map((entry) => ({
    areaKey: entry.areaKey,
    pages: entry.pages,
    records: entry.records,
    rowsPerPage: entry.rowsPerPage,
    overflow: entry.overflow.map((overflow) => ({
      recordId: overflow.recordId,
      title: overflow.title,
      reason: overflow.reason,
    })),
  })),
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  version: item.version,
});

export function registerLayoutRoutes(
  app: AppInstance,
  service: LayoutService,
  sessions: HumanSessionPort,
  limits: ProgrammingRouteLimits = {
    requests: { max: 300, timeWindow: 60_000 },
  },
): void {
  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure ||
      error instanceof ProgrammingFailure ||
      error instanceof MediaFailure
    ) {
      const failure = respond(
        error.code as Parameters<typeof respond>[0],
        requestId,
        currentTraceId(),
        undefined,
        error instanceof ProgrammingFailure ? error.issues : undefined,
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
    for (const operation of layoutOperations) {
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
            layoutId?: string;
          };
          const companyId = params.companyId;
          const layoutId = params.layoutId ?? "";
          const body = (request.body ?? {}) as Record<string, unknown>;
          try {
            switch (operation.operationId) {
              case "listLayouts": {
                const query = request.query as {
                  limit?: number;
                  cursor?: string;
                  scope?: string;
                  text?: string;
                };
                const page = await service.listLayouts(context, companyId, {
                  ...query,
                  limit: query.limit ?? 50,
                });
                return reply.send({
                  items: page.items.map(summaryWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "createLayout":
                return reply.code(201).send(
                  layoutWire(
                    await service.createLayout(context, companyId, {
                      name: body.name as string,
                      branchId: body.branchId as string | null,
                      definition: body.definition as LayoutInput,
                    }),
                  ),
                );
              case "importLayout":
                return reply.code(201).send(
                  layoutWire(
                    await service.importLayout(context, companyId, {
                      branchId: body.branchId as string | null,
                      document: body.document as LayoutDocument,
                    }),
                  ),
                );
              case "getLayout":
                return reply.send(
                  layoutWire(
                    await service.getLayout(context, companyId, layoutId),
                  ),
                );
              case "updateLayout":
                return reply.send(
                  layoutWire(
                    await service.saveLayout(
                      context,
                      companyId,
                      layoutId,
                      body.expectedVersion as number,
                      body,
                    ),
                  ),
                );
              case "deleteLayout":
                await service.deleteLayout(
                  context,
                  companyId,
                  layoutId,
                  body.expectedVersion as number,
                );
                return reply.code(204).send();
              case "exportLayout":
                return reply.send(
                  await service.exportLayout(context, companyId, layoutId),
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
