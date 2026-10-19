import type { FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
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
import { programmingOperations } from "./contracts.js";
import {
  ProgrammingFailure,
  ruleTimes,
  type ItemInput,
  type OutputKey,
  type RuleInput,
  type Transition,
} from "./domain.js";
import { respond } from "./errors.js";
import type { ProgramSource } from "./prisma-repository.js";
import type {
  DeviceProgrammingView,
  GroupView,
  PlaylistView,
  ProgramView,
  ProgrammingService,
  TimelineView,
} from "./service.js";

export type ProgrammingRouteLimits = Readonly<{
  /** Requests per client address and window. */
  requests: { max: number; timeWindow: number };
}>;

const defaultLimits: ProgrammingRouteLimits = {
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

const playlistWire = (item: PlaylistView) => ({
  id: item.id,
  name: item.name,
  branch: item.branchId
    ? { id: item.branchId, name: item.branchName ?? "" }
    : null,
  transition: item.transition,
  fadeMs: item.fadeMs,
  items: item.items.map((entry) => ({
    mediaAssetId: entry.mediaAssetId,
    name: entry.name,
    kind: entry.kind,
    mediaStatus: entry.mediaStatus,
    durationMs: entry.durationMs,
  })),
  durationMs: item.durationMs,
  videoCount: item.videoCount,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  version: item.version,
});

const groupWire = (group: GroupView) => ({
  id: group.id,
  name: group.name,
  allBranches: group.allBranches,
  branches: group.branches.map((branch) => ({ ...branch })),
  members: group.members.map((member) => ({
    id: member.id,
    name: member.name,
    branch: { id: member.branchId, name: member.branchName },
  })),
  createdAt: group.createdAt.toISOString(),
  updatedAt: group.updatedAt.toISOString(),
  version: group.version,
});

const programWire = (program: ProgramView) => ({
  version: program.version,
  outputs: program.outputs.map((output) => ({
    key: output.key,
    defaultPlaylist: output.defaultPlaylist,
    rules: output.rules.map((rule) => ({
      id: rule.id,
      playlistId: rule.playlistId,
      playlist: rule.playlist,
      weekdays: [...rule.weekdays],
      allDay: rule.allDay,
      ...ruleTimes(rule),
      startsOn: rule.startsOn,
      endsOn: rule.endsOn,
    })),
  })),
});

const deviceWire = (view: DeviceProgrammingView) => ({
  device: {
    id: view.device.id,
    name: view.device.name,
    branch: {
      id: view.device.branchId,
      name: view.device.branchName,
      timeZone: view.device.branchTimeZone,
    },
    timeZone: view.device.timeZone,
  },
  group: view.group,
  individual: view.individual,
  source: view.source,
  version: view.version,
});

const timelineWire = (timeline: TimelineView) => ({
  source:
    timeline.source.kind === "group"
      ? {
          kind: "group" as const,
          group: {
            id: timeline.source.groupId,
            name: timeline.source.groupName,
          },
        }
      : { kind: "individual" as const },
  timeZone: timeline.timeZone,
  segments: timeline.segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    localStart: segment.localStart,
    localEnd: segment.localEnd,
    source: segment.source.kind,
    ruleId: segment.source.kind === "rule" ? segment.source.ruleId : null,
    playlist: segment.playlist,
  })),
  notes: timeline.notes.map((note) => ({ ...note })),
});

export function registerProgrammingRoutes(
  app: AppInstance,
  service: ProgrammingService,
  sessions: HumanSessionPort,
  limits: ProgrammingRouteLimits = defaultLimits,
): void {
  function fail(reply: FastifyReply, error: unknown, requestId: string) {
    if (
      error instanceof SessionFailure ||
      error instanceof OrganizationFailure ||
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
    for (const operation of programmingOperations) {
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
            playlistId?: string;
            groupId?: string;
            deviceId?: string;
            outputKey?: OutputKey;
          };
          const companyId = params.companyId;
          const playlistId = params.playlistId ?? "";
          const groupId = params.groupId ?? "";
          const deviceId = params.deviceId ?? "";
          const body = (request.body ?? {}) as Record<string, unknown>;
          const expectedVersion = body.expectedVersion as number;
          const output = body as {
            defaultPlaylistId: string | null;
            rules: RuleInput[];
          };
          try {
            switch (operation.operationId) {
              case "listPlaylists": {
                const query = request.query as {
                  limit?: number;
                  cursor?: string;
                  scope?: string;
                  text?: string;
                };
                const page = await service.listPlaylists(context, companyId, {
                  ...query,
                  limit: query.limit ?? 50,
                });
                return reply.send({
                  items: page.items.map(playlistWire),
                  nextCursor: page.nextCursor,
                });
              }
              case "createPlaylist":
                return reply.code(201).send(
                  playlistWire(
                    await service.createPlaylist(
                      context,
                      companyId,
                      body as {
                        name: string;
                        branchId: string | null;
                        transition?: Transition;
                        fadeMs?: number | null;
                      },
                    ),
                  ),
                );
              case "getPlaylist":
                return reply.send(
                  playlistWire(
                    await service.getPlaylist(context, companyId, playlistId),
                  ),
                );
              case "updatePlaylist":
                return reply.send(
                  playlistWire(
                    await service.updatePlaylist(
                      context,
                      companyId,
                      playlistId,
                      expectedVersion,
                      body,
                    ),
                  ),
                );
              case "replacePlaylistItems":
                return reply.send(
                  playlistWire(
                    await service.replaceItems(
                      context,
                      companyId,
                      playlistId,
                      expectedVersion,
                      body.items as ItemInput[],
                    ),
                  ),
                );
              case "deletePlaylist":
                await service.deletePlaylist(
                  context,
                  companyId,
                  playlistId,
                  expectedVersion,
                );
                return reply.code(204).send();
              case "listProgrammingGroups":
                return reply.send({
                  items: (await service.listGroups(context, companyId)).map(
                    groupWire,
                  ),
                });
              case "createProgrammingGroup":
                return reply.code(201).send(
                  groupWire(
                    await service.createGroup(
                      context,
                      companyId,
                      body as {
                        name: string;
                        allBranches: boolean;
                        branchIds: string[];
                      },
                    ),
                  ),
                );
              case "getProgrammingGroup":
                return reply.send(
                  groupWire(
                    await service.getGroup(context, companyId, groupId),
                  ),
                );
              case "updateProgrammingGroup":
                return reply.send(
                  groupWire(
                    await service.updateGroup(
                      context,
                      companyId,
                      groupId,
                      expectedVersion,
                      body,
                    ),
                  ),
                );
              case "deleteProgrammingGroup":
                await service.deleteGroup(
                  context,
                  companyId,
                  groupId,
                  expectedVersion,
                );
                return reply.code(204).send();
              case "getGroupProgram":
              case "getDeviceProgram": {
                const source: ProgramSource =
                  operation.operationId === "getGroupProgram"
                    ? { kind: "group", groupId }
                    : { kind: "device", deviceId };
                return reply.send(
                  programWire(
                    await service.getProgram(context, companyId, source),
                  ),
                );
              }
              case "replaceGroupProgramOutput":
              case "replaceDeviceProgramOutput": {
                const source: ProgramSource =
                  operation.operationId === "replaceGroupProgramOutput"
                    ? { kind: "group", groupId }
                    : { kind: "device", deviceId };
                return reply.send(
                  programWire(
                    await service.replaceOutput(
                      context,
                      companyId,
                      source,
                      params.outputKey ?? "screen",
                      expectedVersion,
                      {
                        defaultPlaylistId: output.defaultPlaylistId,
                        rules: output.rules,
                      },
                    ),
                  ),
                );
              }
              case "getDeviceProgramming":
                return reply.send(
                  deviceWire(
                    await service.getDeviceProgramming(
                      context,
                      companyId,
                      deviceId,
                    ),
                  ),
                );
              case "assignDeviceProgramming":
                return reply.send(
                  deviceWire(
                    await service.assign(
                      context,
                      companyId,
                      deviceId,
                      body as {
                        expectedVersion: number;
                        groupId: string | null;
                        individual: boolean;
                        confirmUnpublished: boolean;
                      },
                    ),
                  ),
                );
              case "checkScheduleRules":
                return reply.send(
                  await service.checkRules(context, companyId, output.rules),
                );
              case "getDeviceTimeline":
                return reply.send(
                  timelineWire(
                    await service.deviceTimeline(
                      context,
                      companyId,
                      deviceId,
                      request.query as { from: string; to: string },
                    ),
                  ),
                );
              case "getGroupTimeline":
                return reply.send(
                  timelineWire(
                    await service.groupTimeline(
                      context,
                      companyId,
                      groupId,
                      request.query as {
                        from: string;
                        to: string;
                        timeZone: string;
                      },
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
