import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";
import type { ApiOperation } from "../../module.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const uuid = Type.String({ pattern: uuidPattern });
const instant = Type.String({ format: "date-time" });
const version = Type.Integer({ minimum: 1 });
// Settings and programs that were never saved have version 0.
const observedVersion = Type.Integer({ minimum: 0 });
const visibleText = "^[^\\u0000-\\u001f\\u007f]*\\S[^\\u0000-\\u001f\\u007f]*$";
const playlistName = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: visibleText,
});
const groupName = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: visibleText,
});
const transition = Type.Union([Type.Literal("CUT"), Type.Literal("FADE")]);
const fadeMs = Type.Integer({ minimum: 250, maximum: 2000 });
const localDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const localTime = Type.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" });
const timeZone = Type.String({ minLength: 1, maxLength: 64 });
const outputKey = Type.Literal("screen");
const mediaStatus = Type.Union([
  Type.Literal("UPLOADING"),
  Type.Literal("PROCESSING"),
  Type.Literal("READY"),
  Type.Literal("REJECTED"),
  Type.Literal("FAILED"),
  Type.Literal("ARCHIVED"),
  Type.Literal("DELETED"),
  Type.Literal("PURGED"),
]);
const named = Type.Object(
  { id: uuid, name: Type.String() },
  { additionalProperties: false },
);

const common = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
  503: errorEnvelopeSchema,
};
const session = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_LIMIT_REACHED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "VALIDATION_FAILED",
] as const;
const scoped = [
  ...session,
  "RESOURCE_NOT_FOUND",
  "COMPANY_SUSPENDED",
  "PERMISSION_DENIED",
  "STRONG_AUTHENTICATION_REQUIRED",
] as const;
const mutation = [
  ...scoped,
  "CSRF_VALIDATION_FAILED",
  "RESOURCE_VERSION_CONFLICT",
] as const;

export const playlistSummarySchema = Type.Object(
  {
    id: uuid,
    name: Type.String(),
    durationMs: Type.Integer({ minimum: 0 }),
    itemCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const playlistSchema = Type.Object(
  {
    id: uuid,
    name: playlistName,
    branch: Type.Union([named, Type.Null()]),
    transition,
    fadeMs: Type.Union([fadeMs, Type.Null()]),
    items: Type.Array(
      Type.Object(
        {
          mediaAssetId: uuid,
          name: Type.String(),
          kind: Type.Union([Type.Literal("IMAGE"), Type.Literal("VIDEO")]),
          mediaStatus,
          durationMs: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    durationMs: Type.Integer({ minimum: 0 }),
    videoCount: Type.Integer({ minimum: 0 }),
    createdAt: instant,
    updatedAt: instant,
    version,
  },
  { additionalProperties: false },
);

export const groupSchema = Type.Object(
  {
    id: uuid,
    name: groupName,
    allBranches: Type.Boolean(),
    branches: Type.Array(
      Type.Object(
        { id: uuid, name: Type.String(), timeZone: Type.String() },
        { additionalProperties: false },
      ),
    ),
    members: Type.Array(
      Type.Object(
        { id: uuid, name: Type.String(), branch: named },
        { additionalProperties: false },
      ),
    ),
    createdAt: instant,
    updatedAt: instant,
    version,
  },
  { additionalProperties: false },
);

const ruleFields = {
  playlistId: uuid,
  weekdays: Type.Array(Type.Integer({ minimum: 1, maximum: 7 }), {
    minItems: 1,
    maxItems: 7,
    uniqueItems: true,
  }),
  allDay: Type.Boolean(),
  startTime: Type.Optional(Type.Union([localTime, Type.Null()])),
  endTime: Type.Optional(Type.Union([localTime, Type.Null()])),
  startsOn: localDate,
  endsOn: Type.Optional(Type.Union([localDate, Type.Null()])),
};
const ruleInput = Type.Object(ruleFields, { additionalProperties: false });
const ruleSet = Type.Array(ruleInput, { maxItems: 200 });

export const programSchema = Type.Object(
  {
    version: observedVersion,
    outputs: Type.Array(
      Type.Object(
        {
          key: outputKey,
          defaultPlaylist: Type.Union([playlistSummarySchema, Type.Null()]),
          rules: Type.Array(
            Type.Object(
              {
                id: uuid,
                playlistId: uuid,
                playlist: Type.Union([playlistSummarySchema, Type.Null()]),
                weekdays: Type.Array(Type.Integer({ minimum: 1, maximum: 7 })),
                allDay: Type.Boolean(),
                startTime: Type.Union([localTime, Type.Null()]),
                endTime: Type.Union([localTime, Type.Null()]),
                startsOn: localDate,
                endsOn: Type.Union([localDate, Type.Null()]),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const deviceProgrammingSchema = Type.Object(
  {
    device: Type.Object(
      {
        id: uuid,
        name: Type.String(),
        branch: Type.Object(
          { id: uuid, name: Type.String(), timeZone: Type.String() },
          { additionalProperties: false },
        ),
        timeZone: Type.Union([Type.String(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    group: Type.Union([named, Type.Null()]),
    individual: Type.Boolean(),
    source: Type.Union([Type.Literal("group"), Type.Literal("individual")]),
    version: observedVersion,
  },
  { additionalProperties: false },
);

export const timelineSchema = Type.Object(
  {
    source: Type.Union([
      Type.Object(
        { kind: Type.Literal("group"), group: named },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("individual") },
        { additionalProperties: false },
      ),
    ]),
    timeZone: Type.String(),
    segments: Type.Array(
      Type.Object(
        {
          start: instant,
          end: instant,
          localStart: Type.String(),
          localEnd: Type.String(),
          source: Type.Union([
            Type.Literal("rule"),
            Type.Literal("default"),
            Type.Literal("none"),
          ]),
          ruleId: Type.Union([uuid, Type.Null()]),
          playlist: Type.Union([playlistSummarySchema, Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    notes: Type.Array(
      Type.Object(
        {
          ruleId: uuid,
          boundary: Type.Union([Type.Literal("start"), Type.Literal("end")]),
          resolution: Type.Union([
            Type.Literal("gap"),
            Type.Literal("repeated"),
          ]),
          local: Type.String(),
          instant,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const companyParams = Type.Object(
  { companyId: uuid },
  { additionalProperties: false },
);
const playlistParams = Type.Object(
  { companyId: uuid, playlistId: uuid },
  { additionalProperties: false },
);
const groupParams = Type.Object(
  { companyId: uuid, groupId: uuid },
  { additionalProperties: false },
);
const deviceParams = Type.Object(
  { companyId: uuid, deviceId: uuid },
  { additionalProperties: false },
);
const groupOutputParams = Type.Object(
  { companyId: uuid, groupId: uuid, outputKey },
  { additionalProperties: false },
);
const deviceOutputParams = Type.Object(
  { companyId: uuid, deviceId: uuid, outputKey },
  { additionalProperties: false },
);
const versionBody = Type.Object(
  { expectedVersion: version },
  { additionalProperties: false },
);
const outputBody = Type.Object(
  {
    expectedVersion: observedVersion,
    defaultPlaylistId: Type.Union([uuid, Type.Null()]),
    rules: ruleSet,
  },
  { additionalProperties: false },
);
const range = {
  from: instant,
  to: instant,
};

export const programmingOperations = [
  {
    method: "GET",
    url: "/companies/:companyId/programming/playlists",
    operationId: "listPlaylists",
    access: "session",
    description:
      "The company's playlists the caller may view, newest first: company playlists for anyone who may view programming, and playlists of granted branches. Filter by scope (company or a branch) and name text. Cursors are bound to the company, caller, visible scope and filters.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        {
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
          // "company" or a branch ID, as one string so clients get a plain type.
          scope: Type.Optional(
            Type.String({
              pattern: `^(company|${uuidPattern.slice(1, -1)})$`,
            }),
          ),
          text: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          {
            items: Type.Array(playlistSchema),
            nextCursor: Type.Union([Type.String(), Type.Null()]),
          },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "POST",
    url: "/companies/:companyId/programming/playlists",
    operationId: "createPlaylist",
    access: "session",
    description:
      "Create an empty playlist owned by the company (null branch, which needs company-wide authority) or one branch. The transition is CUT unless FADE is chosen with a duration from 250 to 2,000 ms. The owning scope never changes.",
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          name: playlistName,
          branchId: Type.Union([uuid, Type.Null()]),
          transition: Type.Optional(transition),
          fadeMs: Type.Optional(Type.Union([fadeMs, Type.Null()])),
        },
        { additionalProperties: false },
      ),
      response: { 201: playlistSchema, ...common },
    },
    expectedErrors: [...mutation, "PROGRAMMING_LIMIT_REACHED"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/playlists/:playlistId",
    operationId: "getPlaylist",
    access: "session",
    description:
      "One playlist the caller may view, with its ordered items, total duration and video count.",
    schema: {
      params: playlistParams,
      response: { 200: playlistSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/programming/playlists/:playlistId",
    operationId: "updatePlaylist",
    access: "session",
    description:
      "Rename a playlist or change its transition with the observed version. A fade duration is sent only together with the transition.",
    schema: {
      params: playlistParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(playlistName),
          transition: Type.Optional(transition),
          fadeMs: Type.Optional(Type.Union([fadeMs, Type.Null()])),
        },
        { additionalProperties: false },
      ),
      response: { 200: playlistSchema, ...common },
    },
    expectedErrors: [...mutation],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/programming/playlists/:playlistId/items",
    operationId: "replacePlaylistItems",
    access: "session",
    description:
      "Replace the whole ordered item list with the observed version, so reordering is one change. New media must be ready and belong to the company or to the playlist's branch; media already in the playlist may stay after being archived. Image items last 1 to 3,600 whole seconds, 10 by default; video items have no duration and play in full. At most 500 items.",
    schema: {
      params: playlistParams,
      body: Type.Object(
        {
          expectedVersion: version,
          items: Type.Array(
            Type.Object(
              {
                mediaAssetId: uuid,
                durationSeconds: Type.Optional(
                  Type.Union([
                    Type.Integer({ minimum: 1, maximum: 3600 }),
                    Type.Null(),
                  ]),
                ),
              },
              { additionalProperties: false },
            ),
            { maxItems: 500 },
          ),
        },
        { additionalProperties: false },
      ),
      response: { 200: playlistSchema, ...common },
    },
    expectedErrors: [...mutation, "PLAYLIST_SCOPE_MISMATCH", "MEDIA_NOT_READY"],
  },
  {
    method: "DELETE",
    url: "/companies/:companyId/programming/playlists/:playlistId",
    operationId: "deletePlaylist",
    access: "session",
    description:
      "Delete a playlist and its items. A playlist used by a schedule or a default answers PLAYLIST_IN_USE and nothing changes.",
    schema: {
      params: playlistParams,
      body: versionBody,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...mutation, "PLAYLIST_IN_USE"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/groups",
    operationId: "listProgrammingGroups",
    access: "session",
    description:
      "The company's programming groups whose whole branch span the caller may view, by name, with their branches and member screens.",
    schema: {
      params: companyParams,
      response: {
        200: Type.Object(
          { items: Type.Array(groupSchema) },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "POST",
    url: "/companies/:companyId/programming/groups",
    operationId: "createProgrammingGroup",
    access: "session",
    description:
      "Create a programming group covering the whole company or one to 100 active branches. Names are unique within the company, ignoring case. The group starts without screens and with an empty program.",
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          name: groupName,
          allBranches: Type.Boolean(),
          branchIds: Type.Array(uuid, { maxItems: 100 }),
        },
        { additionalProperties: false },
      ),
      response: { 201: groupSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "PROGRAMMING_LIMIT_REACHED",
      "GROUP_NAME_IN_USE",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/groups/:groupId",
    operationId: "getProgrammingGroup",
    access: "session",
    description:
      "One programming group. A group the caller can see only partly answers RESOURCE_NOT_FOUND.",
    schema: {
      params: groupParams,
      response: { 200: groupSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/programming/groups/:groupId",
    operationId: "updateProgrammingGroup",
    access: "session",
    description:
      "Rename a group or change its branch span with the observed version; a span change sends allBranches and, for a fixed span, branchIds. Removing a branch that still has member screens answers GROUP_SPAN_EXCLUDES_DEVICE, and a span the group's schedules cannot use answers PLAYLIST_SCOPE_MISMATCH.",
    schema: {
      params: groupParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(groupName),
          allBranches: Type.Optional(Type.Boolean()),
          branchIds: Type.Optional(Type.Array(uuid, { maxItems: 100 })),
        },
        { additionalProperties: false },
      ),
      response: { 200: groupSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "GROUP_NAME_IN_USE",
      "GROUP_SPAN_EXCLUDES_DEVICE",
      "PLAYLIST_SCOPE_MISMATCH",
    ],
  },
  {
    method: "DELETE",
    url: "/companies/:companyId/programming/groups/:groupId",
    operationId: "deleteProgrammingGroup",
    access: "session",
    description:
      "Delete a group without member screens, together with its program.",
    schema: {
      params: groupParams,
      body: versionBody,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...mutation, "GROUP_HAS_MEMBERS"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/groups/:groupId/program",
    operationId: "getGroupProgram",
    access: "session",
    description:
      "The group's draft program: per output, its schedules and optional default playlist. It is created with the group at version 1.",
    schema: {
      params: groupParams,
      response: { 200: programSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/programming/groups/:groupId/program/outputs/:outputKey",
    operationId: "replaceGroupProgramOutput",
    access: "session",
    description:
      "Replace one output's whole schedule set and default playlist with the observed program version. Overlapping schedules answer SCHEDULE_CONFLICT; use checkScheduleRules to find them. Playlists must belong to the company, or to the group's branch when the span is exactly that branch.",
    schema: {
      params: groupOutputParams,
      body: outputBody,
      response: { 200: programSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "SCHEDULE_TIMES_EQUAL",
      "SCHEDULE_CONFLICT",
      "PLAYLIST_SCOPE_MISMATCH",
      "PROGRAMMING_LIMIT_REACHED",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/devices/:deviceId",
    operationId: "getDeviceProgramming",
    access: "session",
    description:
      "A screen's programming source: its group, whether individual programming is selected, and the settings version that assignments send. Version 0 means the screen was never assigned.",
    schema: {
      params: deviceParams,
      response: { 200: deviceProgrammingSchema, ...common },
    },
    expectedErrors: [...scoped, "DEVICE_UNLINKED"],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/programming/devices/:deviceId/assignment",
    operationId: "assignDeviceProgramming",
    access: "session",
    description:
      "Join or leave a group and select or clear individual programming, with the observed settings version. A screen without a group is always individual. While the destination has no published programming, which is every destination until publication exists, confirmUnpublished must be true; otherwise the answer is ASSIGNMENT_CONFIRMATION_REQUIRED.",
    schema: {
      params: deviceParams,
      body: Type.Object(
        {
          expectedVersion: observedVersion,
          groupId: Type.Union([uuid, Type.Null()]),
          individual: Type.Boolean(),
          confirmUnpublished: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      response: { 200: deviceProgrammingSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "ASSIGNMENT_CONFIRMATION_REQUIRED",
      "GROUP_SPAN_EXCLUDES_DEVICE",
      "DEVICE_UNLINKED",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/devices/:deviceId/program",
    operationId: "getDeviceProgram",
    access: "session",
    description:
      "The screen's own draft program, used when it has no group or individual programming is selected. Version 0 means it was never saved.",
    schema: {
      params: deviceParams,
      response: { 200: programSchema, ...common },
    },
    expectedErrors: [...scoped, "DEVICE_UNLINKED"],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/programming/devices/:deviceId/program/outputs/:outputKey",
    operationId: "replaceDeviceProgramOutput",
    access: "session",
    description:
      "Replace one output of the screen's own program with the observed program version; version 0 creates the program. Playlists must belong to the company or to the screen's branch.",
    schema: {
      params: deviceOutputParams,
      body: outputBody,
      response: { 200: programSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "SCHEDULE_TIMES_EQUAL",
      "SCHEDULE_CONFLICT",
      "PLAYLIST_SCOPE_MISMATCH",
      "PROGRAMMING_LIMIT_REACHED",
      "DEVICE_UNLINKED",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/programming/rule-checks",
    operationId: "checkScheduleRules",
    access: "session",
    description:
      "Check a schedule set without saving it: schedules whose start equals their end, and each pair of overlapping schedules (by index) with the first local date on which they overlap. Validation uses local wall-clock time, so it holds in every zone.",
    schema: {
      params: companyParams,
      body: Type.Object({ rules: ruleSet }, { additionalProperties: false }),
      response: {
        200: Type.Object(
          {
            issues: Type.Array(
              Type.Object(
                {
                  index: Type.Integer({ minimum: 0 }),
                  code: Type.Literal("SCHEDULE_TIMES_EQUAL"),
                },
                { additionalProperties: false },
              ),
            ),
            conflicts: Type.Array(
              Type.Object(
                {
                  first: Type.Integer({ minimum: 0 }),
                  second: Type.Integer({ minimum: 0 }),
                  date: localDate,
                },
                { additionalProperties: false },
              ),
            ),
          },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...scoped, "CSRF_VALIDATION_FAILED"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/devices/:deviceId/timeline",
    operationId: "getDeviceTimeline",
    access: "session",
    description:
      "Evaluate the screen's current draft source in its time zone (its own, otherwise its branch's) over at most 31 days: ordered segments with what plays, and notes for times moved by daylight saving changes.",
    schema: {
      params: deviceParams,
      querystring: Type.Object(range, { additionalProperties: false }),
      response: { 200: timelineSchema, ...common },
    },
    expectedErrors: [...scoped, "DEVICE_UNLINKED", "TIMELINE_TOO_LARGE"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/groups/:groupId/timeline",
    operationId: "getGroupTimeline",
    access: "session",
    description:
      "Evaluate the group's draft program in a time zone the caller chooses over at most 31 days, so a group can be previewed before it has screens.",
    schema: {
      params: groupParams,
      querystring: Type.Object(
        { ...range, timeZone },
        { additionalProperties: false },
      ),
      response: { 200: timelineSchema, ...common },
    },
    expectedErrors: [...scoped, "TIMELINE_TOO_LARGE"],
  },
] as const satisfies readonly ApiOperation[];
