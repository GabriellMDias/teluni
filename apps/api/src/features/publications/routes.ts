import type { FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { parseRange } from "../../byte-range.js";
import {
  deviceAddressCeiling,
  registerDeviceRequestLimits,
} from "../../device-request-limits.js";
import type { AppInstance } from "../../module.js";
import { currentTraceId } from "../../request-context.js";
import { DeviceFailure } from "../devices/public.js";
import {
  SessionFailure,
  type HumanContext,
  type HumanSessionPort,
} from "../identity/public.js";
import { MediaFailure } from "../media/public.js";
import { OrganizationFailure } from "../organizations/public.js";
import {
  ProgrammingFailure,
  type ProgramSource,
} from "../programming/public.js";
import { publicationOperations } from "./contracts.js";
import { PublicationFailure } from "./domain.js";
import { respond } from "./errors.js";
import type {
  CheckView,
  PriceIntentView,
  PublicationService,
  PublicationView,
  ScreenStateView,
  SyncReport,
} from "./service.js";

export type PublicationRouteLimits = Readonly<{
  /** Requests per client address and window on human routes. */
  requests: { max: number; timeWindow: number };
  /** Requests per presented credential and window on screen routes. */
  devices: { max: number; timeWindow: number };
  /** Requests per client address and window on screen routes. */
  deviceAddresses?: { max: number; timeWindow: number };
}>;

const defaultLimits: PublicationRouteLimits = {
  requests: { max: 300, timeWindow: 60_000 },
  devices: { max: 120, timeWindow: 60_000 },
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

const publicationWire = (item: PublicationView) => ({
  id: item.id,
  generation: item.generation,
  protocol: item.protocol,
  publishedAt: item.publishedAt.toISOString(),
  publishedBy: {
    membershipId: item.publishedByMembershipId,
    isCaller: item.isCaller,
  },
  restoredFromGeneration: item.restoredFromGeneration,
  origin: item.origin.toLowerCase(),
  counts: { ...item.counts },
  manifestSha256: item.manifestSha256.toString("hex"),
  state: item.state,
  supersededAt: item.supersededAt?.toISOString() ?? null,
});

const priceIntentWire = (item: PriceIntentView) => ({
  id: item.id,
  state: item.state.toLowerCase(),
  reason: item.reason,
  target: item.target ? { ...item.target } : null,
  priceSequence: item.priceSequence,
  generation: item.generation,
  authorIsCaller: item.authorIsCaller,
  reauthorized: item.authorizedByMembershipId !== null,
  attempts: item.attempts,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

const checkWire = (check: CheckView) => ({
  publishable: check.problems.length === 0,
  problems: check.problems.map((problem) => ({ ...problem })),
  counts: { ...check.counts },
  contentDigest: check.contentDigest,
  unchanged: check.unchanged,
  latest: check.latest ? publicationWire(check.latest) : null,
  followers: check.followers,
});

const stateWire = (view: ScreenStateView) => ({
  deviceId: view.deviceId,
  connection: view.connection,
  lastContactAt: view.lastContactAt?.toISOString() ?? null,
  source: view.source,
  desired: view.desired,
  publication: view.publication,
  reported: view.reported
    ? {
        receivedAt: view.reported.receivedAt.toISOString(),
        appVersion: view.reported.appVersion,
        protocol: view.reported.protocol,
        active: view.reported.activePublicationId
          ? {
              publicationId: view.reported.activePublicationId,
              generation: view.reported.activeGeneration,
              since: view.reported.activeSince?.toISOString() ?? null,
            }
          : null,
        staging: view.reported.staging
          ? {
              publicationId: view.reported.staging.publicationId,
              generation: view.reported.stagingGeneration,
              state: view.reported.staging.state,
              failure: view.reported.staging.failure,
              bytesDone: view.reported.staging.bytesDone,
              bytesTotal: view.reported.staging.bytesTotal,
            }
          : null,
        playback: view.reported.playback,
        storage: view.reported.storage,
      }
    : null,
});

export function registerPublicationRoutes(
  app: AppInstance,
  service: PublicationService,
  sessions: HumanSessionPort,
  limits: PublicationRouteLimits = defaultLimits,
): void {
  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure ||
      error instanceof PublicationFailure ||
      error instanceof ProgrammingFailure ||
      error instanceof MediaFailure ||
      error instanceof DeviceFailure
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

  // Human routes authenticate the session on every request.
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
    for (const operation of publicationOperations.filter(
      (item) => item.access === "session",
    ))
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
            groupId?: string;
            deviceId?: string;
            publicationId?: string;
            catalogId?: string;
            intentId?: string;
          };
          const { companyId } = params;
          const source: ProgramSource = params.groupId
            ? { kind: "group", groupId: params.groupId }
            : { kind: "device", deviceId: params.deviceId ?? "" };
          try {
            switch (operation.operationId) {
              case "listGroupPublications":
              case "listDevicePublications": {
                const query = request.query as {
                  limit?: number;
                  cursor?: string;
                };
                const page = await service.list(context, companyId, source, {
                  limit: query.limit ?? 20,
                  ...(query.cursor ? { cursor: query.cursor } : {}),
                });
                return reply.send({
                  items: page.items.map(publicationWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "checkGroupPublication":
              case "checkDevicePublication":
                return reply.send(
                  checkWire(await service.check(context, companyId, source)),
                );
              case "publishGroup":
              case "publishDevice": {
                const result = await service.publish(
                  context,
                  companyId,
                  source,
                  (request.body as { contentDigest: string }).contentDigest,
                );
                return reply.code(result.created ? 201 : 200).send({
                  publication: publicationWire(result.publication),
                  created: result.created,
                });
              }
              case "restoreGroupPublication":
              case "restoreDevicePublication": {
                const result = await service.restore(
                  context,
                  companyId,
                  source,
                  params.publicationId ?? "",
                );
                return reply.code(result.created ? 201 : 200).send({
                  publication: publicationWire(result.publication),
                  created: result.created,
                });
              }
              case "getDeviceSyncState":
                return reply.send(
                  stateWire(
                    await service.syncState(
                      context,
                      companyId,
                      params.deviceId ?? "",
                    ),
                  ),
                );
              case "listCatalogPricePublications": {
                const items = await service.pricePublications(
                  context,
                  companyId,
                  params.catalogId ?? "",
                );
                return reply.send({ items: items.map(priceIntentWire) });
              }
              case "retryPricePublication":
                return reply.send(
                  priceIntentWire(
                    await service.retryPricePublication(
                      context,
                      companyId,
                      params.intentId ?? "",
                    ),
                  ),
                );
              case "listScreenStates": {
                const { deviceId } = request.query as { deviceId: string[] };
                const items = await service.screenStates(
                  context,
                  companyId,
                  deviceId,
                );
                return reply.send({ items: items.map(stateWire) });
              }
            }
            throw new Error(`Unhandled operation ${operation.operationId}`);
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
  });

  // Screen routes authenticate the device credential through the devices
  // port on every request.
  void app.register(async (feature) => {
    await registerDeviceRequestLimits(
      feature,
      {
        perCredential: limits.devices,
        perAddress: limits.deviceAddresses ?? deviceAddressCeiling,
      },
      quietHeaders,
    );
    for (const operation of publicationOperations.filter(
      (item) => item.access === "device",
    ))
      feature.route({
        method: operation.method,
        url: operation.url,
        schema: operation.schema,
        handler: async (request, reply) => {
          const authorization = request.headers.authorization;
          try {
            switch (operation.operationId) {
              case "syncDevice": {
                reply.header("cache-control", "no-store");
                const answer = await service.sync(
                  authorization,
                  request.body as SyncReport,
                );
                return reply.send({
                  ...answer,
                  serverTime: answer.serverTime.toISOString(),
                });
              }
              case "getDeviceKeys":
                reply.header("cache-control", "no-store");
                return reply.send(await service.keys(authorization));
              case "getDeviceManifest": {
                const { publicationId } = request.params as {
                  publicationId: string;
                };
                const manifest = await service.manifest(
                  authorization,
                  publicationId,
                );
                return reply
                  .header("cache-control", "private, no-store")
                  .header("etag", `"${manifest.sha256}"`)
                  .header("x-content-type-options", "nosniff")
                  .type("application/octet-stream")
                  .header("content-length", manifest.bytes.length)
                  .send(manifest.bytes);
              }
              case "getDeviceMedia": {
                const { mediaId } = request.params as { mediaId: string };
                const media = await service.media(authorization, mediaId);
                reply
                  .header("cache-control", "private, no-store")
                  .header("etag", `"${media.sha256.toString("hex")}"`)
                  .header("x-content-type-options", "nosniff")
                  .header("accept-ranges", "bytes");
                const range = parseRange(request.headers.range, media.size);
                if (range === "unsatisfiable") {
                  media.release();
                  const failure = respond(
                    "VALIDATION_FAILED",
                    request.id,
                    currentTraceId(),
                  );
                  return reply
                    .code(416)
                    .header("content-range", `bytes */${media.size}`)
                    .send(failure.body);
                }
                reply.raw.once("close", () => media.release());
                reply.type(media.contentType);
                if (range)
                  return reply
                    .code(206)
                    .header(
                      "content-range",
                      `bytes ${range.start}-${range.end}/${media.size}`,
                    )
                    .header("content-length", range.end - range.start + 1)
                    .send(media.open(range));
                return reply
                  .header("content-length", media.size)
                  .send(media.open());
              }
            }
            throw new Error(`Unhandled operation ${operation.operationId}`);
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
  });
}
