import type { FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppInstance } from "../../module.js";
import { currentTraceId } from "../../request-context.js";
import {
  SessionFailure,
  type HumanContext,
  type HumanSessionPort,
} from "../identity/public.js";
import { OrganizationFailure } from "../organizations/public.js";
import { deviceOperations } from "./contracts.js";
import {
  DeviceFailure,
  devicePolicy,
  type DeviceReport,
  type DeviceStatus,
  type Rotation,
} from "./domain.js";
import { respond } from "./errors.js";
import type { DeviceIdentity } from "./prisma-repository.js";
import type { DeviceService, DeviceView } from "./service.js";

export type DeviceRouteLimits = Readonly<{
  /** Requests per client address and window on human and device routes. */
  requests: { max: number; timeWindow: number };
  /** Enrollment starts per client address and window (design: 20 per hour). */
  enrollmentStarts: { max: number; timeWindow: number };
}>;

const defaultLimits: DeviceRouteLimits = {
  requests: { max: 120, timeWindow: 60_000 },
  enrollmentStarts: {
    max: devicePolicy.enrollmentStartsPerAddressPerHour,
    timeWindow: 60 * 60_000,
  },
};

const deviceWire = (device: DeviceView) => ({
  id: device.id,
  name: device.name,
  branch: {
    id: device.branchId,
    name: device.branchName,
    timeZone: device.branchTimeZone,
  },
  timeZone: device.timeZone,
  rotation: device.rotation,
  status: device.status,
  erasure: device.erasure,
  report: device.report,
  lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
  pairedAt: device.pairedAt.toISOString(),
  revokedAt: device.revokedAt?.toISOString() ?? null,
  erasureRecordedAt: device.erasureRecordedAt?.toISOString() ?? null,
  version: device.version,
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

type Operation = (typeof deviceOperations)[number];

export function registerDeviceRoutes(
  app: AppInstance,
  service: DeviceService,
  sessions: HumanSessionPort,
  limits: DeviceRouteLimits = defaultLimits,
): void {
  function fail(
    reply: FastifyReply,
    error: unknown,
    requestId: string,
    retryAfterSeconds?: number,
  ) {
    if (
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure ||
      error instanceof DeviceFailure
    ) {
      // Organization failures reaching devices are access and tenant codes,
      // all registered with the organizations module.
      const failure = respond(
        error.code as Parameters<typeof respond>[0],
        requestId,
        currentTraceId(),
      );
      if (error.code === "RATE_LIMITED")
        reply.header(
          "retry-after",
          String(retryAfterSeconds ?? devicePolicy.failedClaimWindowSeconds),
        );
      return reply.code(failure.status).send(failure.body);
    }
    throw error;
  }
  const byAccess = (access: Operation["access"]) =>
    deviceOperations.filter((operation) => operation.access === access);

  // Anonymous enrollment start, limited per client address.
  void app.register(async (feature) => {
    await feature.register(rateLimit, {
      ...limits.enrollmentStarts,
      hook: "onRequest",
      ...quietHeaders,
    });
    feature.addHook("onSend", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });
    for (const operation of byAccess("public"))
      feature.route({
        method: operation.method,
        url: operation.url,
        schema: operation.schema,
        handler: async (request, reply) => {
          try {
            const started = await service.startEnrollment(
              request.body as { credentialHash: string; report: DeviceReport },
            );
            return reply
              .code(201)
              .send({ ...started, expiresAt: started.expiresAt.toISOString() });
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
  });

  // Device routes authenticate the bearer device credential on every request.
  void app.register(async (feature) => {
    await feature.register(rateLimit, {
      ...limits.requests,
      hook: "onRequest",
      ...quietHeaders,
    });
    feature.addHook("onSend", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });
    const identities = new WeakMap<
      FastifyRequest,
      { identity: DeviceIdentity; hash: Buffer }
    >();
    for (const operation of byAccess("device"))
      feature.route({
        method: operation.method,
        url: operation.url,
        schema: operation.schema,
        preValidation: async (request, reply) => {
          // Enrollment polls prove the credential against the enrollment.
          if (operation.operationId === "getDeviceEnrollmentStatus") return;
          try {
            identities.set(
              request,
              await service.authenticate(request.headers.authorization),
            );
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
        handler: async (request, reply) => {
          try {
            if (operation.operationId === "getDeviceEnrollmentStatus") {
              const match = /^Bearer (\S+)$/.exec(
                request.headers.authorization ?? "",
              );
              const polled = await service.pollEnrollment(
                (request.params as { enrollmentId: string }).enrollmentId,
                match?.[1] ?? "",
              );
              return reply.send({
                ...polled,
                pollIntervalSeconds: devicePolicy.pollIntervalSeconds,
              });
            }
            const authenticated = identities.get(request);
            if (!authenticated) throw new DeviceFailure("DEVICE_UNAUTHORIZED");
            const { identity, hash } = authenticated;
            switch (operation.operationId) {
              case "getDeviceSelf": {
                const self = await service.self(identity);
                return reply.send({
                  ...self,
                  authorizedUntil: self.authorizedUntil?.toISOString() ?? null,
                  serverTime: self.serverTime.toISOString(),
                });
              }
              case "updateDeviceReport":
                await service.updateReport(
                  identity,
                  request.body as DeviceReport,
                );
                return reply.code(204).send();
              case "confirmDeviceErasure":
                await service.confirmErasure(identity);
                return reply.code(204).send();
              case "rotateDeviceCredential":
                await service.rotateCredential(
                  identity,
                  hash,
                  (request.body as { credentialHash: string }).credentialHash,
                );
                return reply.code(204).send();
            }
          } catch (error) {
            return fail(
              reply,
              error,
              request.id,
              operation.operationId === "getDeviceEnrollmentStatus"
                ? devicePolicy.pollIntervalSeconds
                : undefined,
            );
          }
        },
      });
  });

  // Human routes authenticate through the identity session boundary.
  void app.register(async (feature) => {
    await feature.register(rateLimit, {
      ...limits.requests,
      hook: "onRequest",
      ...quietHeaders,
    });
    feature.addHook("onSend", async (_request, reply) => {
      reply.header("cache-control", "no-store");
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
    for (const operation of byAccess("session"))
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
          const params = request.params as {
            companyId: string;
            deviceId?: string;
          };
          const body = (request.body ?? {}) as Record<string, unknown>;
          const companyId = params.companyId;
          const deviceId = params.deviceId ?? "";
          const expectedVersion = body.expectedVersion as number;
          try {
            switch (operation.operationId) {
              case "listDevices": {
                const query = request.query as {
                  limit?: number;
                  cursor?: string;
                  branchId?: string;
                  status?: DeviceStatus;
                };
                const page = await service.list(context, companyId, {
                  limit: query.limit ?? 50,
                  ...(query.cursor ? { cursor: query.cursor } : {}),
                  ...(query.branchId ? { branchId: query.branchId } : {}),
                  ...(query.status ? { status: query.status } : {}),
                });
                return reply.send({
                  items: page.items.map(deviceWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "getDevice":
                return reply.send(
                  deviceWire(await service.get(context, companyId, deviceId)),
                );
              case "pairDevice":
                return reply.code(201).send(
                  deviceWire(
                    await service.pair(
                      context,
                      companyId,
                      body as {
                        userCode: string;
                        name: string;
                        branchId: string;
                        rotation: Rotation;
                      },
                    ),
                  ),
                );
              case "updateDevice":
                return reply.send(
                  deviceWire(
                    await service.configure(
                      context,
                      companyId,
                      deviceId,
                      expectedVersion,
                      {
                        ...(body.name !== undefined
                          ? { name: body.name as string }
                          : {}),
                        ...(body.rotation !== undefined
                          ? { rotation: body.rotation as Rotation }
                          : {}),
                        ...(body.timeZone !== undefined
                          ? { timeZone: body.timeZone as string | null }
                          : {}),
                      },
                    ),
                  ),
                );
              case "moveDevice":
                return reply.send(
                  deviceWire(
                    await service.move(
                      context,
                      companyId,
                      deviceId,
                      expectedVersion,
                      body.branchId as string,
                    ),
                  ),
                );
              case "unlinkDevice":
                return reply.send(
                  deviceWire(
                    await service.unlink(
                      context,
                      companyId,
                      deviceId,
                      expectedVersion,
                    ),
                  ),
                );
              case "recordDeviceReset":
                return reply.send(
                  deviceWire(
                    await service.recordReset(
                      context,
                      companyId,
                      deviceId,
                      expectedVersion,
                    ),
                  ),
                );
            }
          } catch (error) {
            return fail(reply, error, request.id);
          }
        },
      });
  });
}
