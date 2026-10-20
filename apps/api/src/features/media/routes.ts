import type { FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppInstance } from "../../module.js";
import { parseRange } from "../../byte-range.js";
import { currentTraceId } from "../../request-context.js";
import {
  SessionFailure,
  type HumanContext,
  type HumanSessionPort,
} from "../identity/public.js";
import { OrganizationFailure } from "../organizations/public.js";
import { mediaOperations } from "./contracts.js";
import {
  downloadName,
  MediaFailure,
  type MediaKind,
  type MediaVariant,
} from "./domain.js";
import { respond } from "./errors.js";
import type { ListFilter } from "./prisma-repository.js";
import type { MediaService, MediaView } from "./service.js";

export type MediaRouteLimits = Readonly<{
  /** Requests per client address and window. */
  requests: { max: number; timeWindow: number };
}>;

const defaultLimits: MediaRouteLimits = {
  requests: { max: 300, timeWindow: 60_000 },
};

/** Longest a streamed upload may take to arrive (a 1 GiB video). */
export const uploadTimeoutMs = 2 * 60 * 60_000;

const mediaWire = (item: MediaView) => ({
  id: item.id,
  name: item.name,
  tags: [...item.tags],
  kind: item.kind,
  status: item.status as Exclude<MediaView["status"], "PURGED">,
  rejectionReason: item.rejectionReason,
  branch: item.branchId
    ? { id: item.branchId, name: item.branchName ?? "" }
    : null,
  declaredContentType: item.declaredContentType,
  declaredSize: item.declaredSize,
  width: item.width,
  height: item.height,
  durationMs: item.durationMs,
  hasAudio: item.hasAudio,
  processing:
    item.status === "PROCESSING"
      ? {
          stage: item.processingStage ?? ("queued" as const),
          progress: item.processingProgress,
        }
      : null,
  createdAt: item.createdAt.toISOString(),
  readyAt: item.readyAt?.toISOString() ?? null,
  archivedAt: item.archivedAt?.toISOString() ?? null,
  deletedAt: item.deletedAt?.toISOString() ?? null,
  purgeAfter: item.purgeAfter?.toISOString() ?? null,
  version: item.version,
});

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

const extensions: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

export function registerMediaRoutes(
  app: AppInstance,
  service: MediaService,
  sessions: HumanSessionPort,
  limits: MediaRouteLimits = defaultLimits,
): void {
  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure ||
      error instanceof MediaFailure
    ) {
      const failure = respond(
        error.code as Parameters<typeof respond>[0],
        requestId,
        currentTraceId(),
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
    // Upload bodies stream to the media volume and are never buffered.
    feature.addContentTypeParser(
      "application/octet-stream",
      (_request, payload, done) => done(null, payload),
    );
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
    for (const operation of mediaOperations) {
      const streamed =
        operation.operationId === "uploadMediaContent" ||
        operation.operationId === "getMediaContent";
      feature.route({
        method: operation.method,
        url: operation.url,
        // Byte bodies and responses are not JSON: validate only parameters.
        schema: streamed
          ? {
              params: operation.schema.params,
              ...("querystring" in operation.schema
                ? { querystring: operation.schema.querystring }
                : {}),
            }
          : operation.schema,
        config: {
          longRequest: operation.operationId === "uploadMediaContent",
        },
        handler: async (request, reply) => {
          const context = contexts.get(request);
          if (!context)
            return fail(
              reply,
              new SessionFailure("AUTHENTICATION_REQUIRED"),
              request.id,
            );
          if (operation.operationId !== "getMediaContent")
            reply.header("cache-control", "no-store");
          const params = request.params as {
            companyId: string;
            assetId?: string;
          };
          const companyId = params.companyId;
          const assetId = params.assetId ?? "";
          const body = (request.body ?? {}) as Record<string, unknown>;
          const expectedVersion = body.expectedVersion as number;
          try {
            switch (operation.operationId) {
              case "listMedia": {
                const query = request.query as {
                  limit?: number;
                  cursor?: string;
                  view?: ListFilter["view"];
                  kind?: MediaKind;
                  scope?: string;
                  tag?: string;
                  text?: string;
                };
                const page = await service.list(context, companyId, {
                  ...query,
                  limit: query.limit ?? 50,
                });
                return reply.send({
                  items: page.items.map(mediaWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "createMedia":
                return reply.code(201).send(
                  mediaWire(
                    await service.create(
                      context,
                      companyId,
                      body as {
                        name: string;
                        branchId: string | null;
                        contentType: string;
                        size: number;
                        tags?: string[];
                      },
                    ),
                  ),
                );
              case "uploadMediaContent": {
                if (
                  request.headers["content-type"] !== "application/octet-stream"
                )
                  throw new MediaFailure("VALIDATION_FAILED");
                const declared = request.headers["content-length"];
                const length =
                  declared && /^\d{1,13}$/.test(declared)
                    ? Number(declared)
                    : undefined;
                return reply.send(
                  mediaWire(
                    await service.upload(
                      context,
                      companyId,
                      assetId,
                      request.body as NodeJS.ReadableStream as never,
                      length,
                    ),
                  ),
                );
              }
              case "getMedia":
                return reply.send(
                  mediaWire(await service.get(context, companyId, assetId)),
                );
              case "getMediaContent": {
                const { variant } = request.query as { variant: MediaVariant };
                const { item, object } = await service.content(
                  context,
                  companyId,
                  assetId,
                  variant,
                );
                const etag = `"${object.sha256.toString("hex")}"`;
                reply
                  .header("cache-control", "private, no-cache")
                  .header("etag", etag)
                  .header("x-content-type-options", "nosniff")
                  .header(
                    "content-security-policy",
                    "sandbox; default-src 'none'",
                  )
                  .header("accept-ranges", "bytes")
                  .header("cross-origin-resource-policy", "same-origin");
                if (variant === "original")
                  reply.header(
                    "content-disposition",
                    `attachment; filename="${downloadName(
                      item.name,
                      extensions[item.declaredContentType] ?? "bin",
                    )}"`,
                  );
                else reply.header("content-disposition", "inline");
                if (request.headers["if-none-match"] === etag)
                  return reply.code(304).send();
                const range = parseRange(
                  request.headers.range,
                  object.byteSize,
                );
                if (range === "unsatisfiable") {
                  const failure = respond(
                    "VALIDATION_FAILED",
                    request.id,
                    currentTraceId(),
                  );
                  return reply
                    .code(416)
                    .header("content-range", `bytes */${object.byteSize}`)
                    .send(failure.body);
                }
                reply.type(object.contentType);
                if (range) {
                  reply
                    .code(206)
                    .header(
                      "content-range",
                      `bytes ${range.start}-${range.end}/${object.byteSize}`,
                    )
                    .header("content-length", range.end - range.start + 1);
                  return reply.send(
                    service.openObject(companyId, object.sha256, range),
                  );
                }
                reply.header("content-length", object.byteSize);
                return reply.send(service.openObject(companyId, object.sha256));
              }
              case "updateMedia":
                return reply.send(
                  mediaWire(
                    await service.configure(
                      context,
                      companyId,
                      assetId,
                      expectedVersion,
                      {
                        ...(body.name !== undefined
                          ? { name: body.name as string }
                          : {}),
                        ...(body.tags !== undefined
                          ? { tags: body.tags as string[] }
                          : {}),
                      },
                    ),
                  ),
                );
              case "archiveMedia":
                return reply.send(
                  mediaWire(
                    await service.archive(
                      context,
                      companyId,
                      assetId,
                      expectedVersion,
                    ),
                  ),
                );
              case "restoreMedia":
                return reply.send(
                  mediaWire(
                    await service.restore(
                      context,
                      companyId,
                      assetId,
                      expectedVersion,
                    ),
                  ),
                );
              case "deleteMedia":
                return reply.send(
                  mediaWire(
                    await service.remove(
                      context,
                      companyId,
                      assetId,
                      expectedVersion,
                    ),
                  ),
                );
              case "restoreDeletedMedia":
                return reply.send(
                  mediaWire(
                    await service.restoreDeleted(
                      context,
                      companyId,
                      assetId,
                      expectedVersion,
                    ),
                  ),
                );
              case "discardMedia":
                await service.discard(
                  context,
                  companyId,
                  assetId,
                  expectedVersion,
                );
                return reply.code(204).send();
            }
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
    }
  });
}
