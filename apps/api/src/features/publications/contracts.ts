import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";
import type { ApiOperation } from "../../module.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const uuid = Type.String({ pattern: uuidPattern });
const instant = Type.String({ format: "date-time" });
const sha256Hex = Type.String({ pattern: "^[0-9a-f]{64}$" });
const count = Type.Integer({ minimum: 0 });
const byteCount = Type.Integer({
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
});
const binary = Type.Unsafe<string>({ type: "string", format: "binary" });

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
  "DEVICE_UNLINKED",
] as const;
const mutation = [...scoped, "CSRF_VALIDATION_FAILED"] as const;
const device = [
  "DEVICE_UNAUTHORIZED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "VALIDATION_FAILED",
] as const;

const counts = Type.Object(
  {
    rules: count,
    playlists: count,
    items: count,
    media: count,
    mediaBytes: byteCount,
  },
  { additionalProperties: false },
);

export const publicationSchema = Type.Object(
  {
    id: uuid,
    generation: Type.Integer({ minimum: 1 }),
    protocol: Type.Integer({ minimum: 1 }),
    publishedAt: instant,
    publishedBy: Type.Object(
      { membershipId: uuid, isCaller: Type.Boolean() },
      { additionalProperties: false },
    ),
    restoredFromGeneration: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null(),
    ]),
    counts,
    manifestSha256: sha256Hex,
    state: Type.Union([
      Type.Literal("current"),
      Type.Literal("retained"),
      Type.Literal("pruned"),
    ]),
    supersededAt: Type.Union([instant, Type.Null()]),
  },
  { additionalProperties: false },
);

const problem = Type.Object(
  {
    code: Type.Union([
      Type.Literal("NOTHING_TO_PUBLISH"),
      Type.Literal("SCHEDULE_INVALID"),
      Type.Literal("PLAYLIST_OUT_OF_SCOPE"),
      Type.Literal("MEDIA_UNAVAILABLE"),
      Type.Literal("TRANSITION_UNSUPPORTED"),
      Type.Literal("TOO_LARGE"),
      Type.Literal("LAYOUT_OUT_OF_SCOPE"),
      Type.Literal("CATALOG_UNAVAILABLE"),
      Type.Literal("CATALOG_FIELD_UNAVAILABLE"),
      Type.Literal("CATALOG_OVERFLOW"),
      Type.Literal("CATALOG_PAGE_MISSING"),
      Type.Literal("CATALOG_GROUP_OVERFLOW"),
    ]),
    playlistId: Type.Optional(uuid),
    mediaId: Type.Optional(uuid),
    areaKey: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9-]{0,15}$" })),
  },
  { additionalProperties: false },
);

export const checkSchema = Type.Object(
  {
    publishable: Type.Boolean(),
    problems: Type.Array(problem),
    counts,
    contentDigest: sha256Hex,
    unchanged: Type.Boolean(),
    latest: Type.Union([publicationSchema, Type.Null()]),
    followers: count,
  },
  { additionalProperties: false },
);

const publishedSchema = Type.Object(
  { publication: publicationSchema, created: Type.Boolean() },
  { additionalProperties: false },
);

const pageQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  },
  { additionalProperties: false },
);
const pageSchema = Type.Object(
  {
    items: Type.Array(publicationSchema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

const stagingState = Type.Union([
  Type.Literal("DOWNLOADING"),
  Type.Literal("VERIFYING"),
  Type.Literal("READY"),
  Type.Literal("FAILED"),
]);
const stagingFailure = Type.Union([
  Type.Literal("STORAGE_FULL"),
  Type.Literal("DOWNLOAD_FAILED"),
  Type.Literal("INTEGRITY_FAILED"),
  Type.Literal("INVALID_MANIFEST"),
  Type.Literal("INCOMPATIBLE"),
]);
const playback = Type.Union([
  Type.Literal("PLAYING"),
  Type.Literal("NEUTRAL"),
  Type.Literal("AUTHORIZATION_EXPIRED"),
  Type.Literal("CLOCK_UNTRUSTED"),
  Type.Literal("DEGRADED"),
  Type.Literal("SETUP"),
]);
const source = Type.Union([Type.Literal("group"), Type.Literal("individual")]);
const generationOrNull = Type.Union([
  Type.Integer({ minimum: 1 }),
  Type.Null(),
]);

export const screenStateSchema = Type.Object(
  {
    deviceId: uuid,
    connection: Type.Union([
      Type.Literal("online"),
      Type.Literal("stale"),
      Type.Literal("offline"),
      Type.Literal("never"),
    ]),
    lastContactAt: Type.Union([instant, Type.Null()]),
    source,
    desired: Type.Union([
      Type.Object(
        { publicationId: uuid, generation: Type.Integer({ minimum: 1 }) },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    publication: Type.Union([
      Type.Literal("up_to_date"),
      Type.Literal("updating"),
      Type.Literal("pending"),
      Type.Literal("failed"),
      Type.Literal("neutral"),
      Type.Literal("unknown"),
    ]),
    reported: Type.Union([
      Type.Object(
        {
          receivedAt: instant,
          appVersion: Type.String(),
          protocol: Type.Integer({ minimum: 1 }),
          active: Type.Union([
            Type.Object(
              {
                publicationId: uuid,
                generation: generationOrNull,
                since: Type.Union([instant, Type.Null()]),
              },
              { additionalProperties: false },
            ),
            Type.Null(),
          ]),
          staging: Type.Union([
            Type.Object(
              {
                publicationId: uuid,
                generation: generationOrNull,
                state: stagingState,
                failure: Type.Union([stagingFailure, Type.Null()]),
                bytesDone: byteCount,
                bytesTotal: byteCount,
              },
              { additionalProperties: false },
            ),
            Type.Null(),
          ]),
          playback,
          storage: Type.Union([
            Type.Object(
              { freeBytes: byteCount, totalBytes: byteCount },
              { additionalProperties: false },
            ),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
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
const companyParams = Type.Object(
  { companyId: uuid },
  { additionalProperties: false },
);
const publishBody = Type.Object(
  { contentDigest: sha256Hex },
  { additionalProperties: false },
);

/** History, check, publish and restore for one kind of destination. */
function programOperations(kind: "group" | "device"): ApiOperation[] {
  const base =
    kind === "group"
      ? "/companies/:companyId/programming/groups/:groupId/publications"
      : "/companies/:companyId/programming/devices/:deviceId/publications";
  const params = kind === "group" ? groupParams : deviceParams;
  const name = kind === "group" ? "Group" : "Device";
  const subject =
    kind === "group"
      ? "a group's program, which needs the capability on every branch of its span"
      : "a screen's own program, which needs the capability on the screen's branch";
  return [
    {
      method: "GET",
      url: base,
      operationId: `list${name}Publications`,
      access: "session",
      description: `The publications of ${subject}, newest generation first, with cursor pagination. Needs programming.view. A pruned publication is listed but can no longer be restored.`,
      schema: {
        params,
        querystring: pageQuery,
        response: { 200: pageSchema, ...common },
      },
      expectedErrors: [...scoped],
    },
    {
      method: "POST",
      url: `${base}/check`,
      operationId: `check${name}Publication`,
      access: "session",
      description: `Build the publication of the current draft of ${subject} without saving it: the problems that block it, its counts, the content digest to publish with, whether it equals the latest publication and how many screens follow it. Needs publications.publish.`,
      schema: {
        params,
        response: { 200: checkSchema, ...common },
      },
      expectedErrors: [...mutation],
    },
    {
      method: "POST",
      url: base,
      operationId: `publish${name}`,
      access: "session",
      description: `Publish the current draft of ${subject} as its next generation, with the content digest from the check. A different digest answers RESOURCE_VERSION_CONFLICT; content equal to the latest publication returns it with created false. Problems answer PUBLICATION_INVALID. Needs publications.publish.`,
      schema: {
        params,
        body: publishBody,
        response: { 200: publishedSchema, 201: publishedSchema, ...common },
      },
      expectedErrors: [
        ...mutation,
        "RESOURCE_VERSION_CONFLICT",
        "PUBLICATION_INVALID",
      ],
    },
    {
      method: "POST",
      url: `${base}/:publicationId/restore`,
      operationId: `restore${name}Publication`,
      access: "session",
      description: `Publish an earlier retained generation of ${subject} again as a new generation, after checking its playlists against the program's current reach and its media; the drafts do not change. Content equal to the latest publication returns it with created false. Needs publications.publish.`,
      schema: {
        params: Type.Object(
          { ...params.properties, publicationId: uuid },
          { additionalProperties: false },
        ),
        response: { 200: publishedSchema, 201: publishedSchema, ...common },
      },
      expectedErrors: [
        ...mutation,
        "PUBLICATION_INVALID",
        "PUBLICATION_NOT_RESTORABLE",
      ],
    },
  ];
}

const reportSchema = Type.Object(
  {
    protocols: Type.Array(Type.Integer({ minimum: 1, maximum: 1000 }), {
      minItems: 1,
      maxItems: 8,
    }),
    appVersion: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    active: Type.Union([
      Type.Object(
        { publicationId: uuid, activatedAt: instant },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    recovery: Type.Union([
      Type.Object({ publicationId: uuid }, { additionalProperties: false }),
      Type.Null(),
    ]),
    staging: Type.Union([
      Type.Object(
        {
          publicationId: uuid,
          state: stagingState,
          failure: Type.Union([stagingFailure, Type.Null()]),
          bytesDone: byteCount,
          bytesTotal: byteCount,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    playback,
    storage: Type.Union([
      Type.Object(
        { freeBytes: byteCount, totalBytes: byteCount },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    deviceTime: Type.Union([instant, Type.Null()]),
  },
  { additionalProperties: false },
);

const syncSchema = Type.Object(
  {
    protocol: Type.Integer({ minimum: 1 }),
    serverTime: instant,
    status: Type.Union([
      Type.Literal("active"),
      Type.Literal("suspended"),
      Type.Literal("unlinked"),
    ]),
    clearRequired: Type.Boolean(),
    timeZone: Type.Union([Type.String(), Type.Null()]),
    zoneOffsets: Type.Union([
      Type.Object(
        {
          until: instant,
          periods: Type.Array(
            Type.Object(
              {
                from: instant,
                offsetSeconds: Type.Integer({
                  minimum: -86_400,
                  maximum: 86_400,
                }),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 64 },
          ),
        },
        {
          additionalProperties: false,
          description:
            "The UTC offsets of `timeZone` from three days before `serverTime` to 35 days after it: the offset at the start, then one period per transition. Screens resolve local schedule times against these instead of their own time zone data.",
        },
      ),
      Type.Null(),
    ]),
    rotation: Type.Union([
      Type.Literal(0),
      Type.Literal(90),
      Type.Literal(180),
      Type.Literal(270),
      Type.Null(),
    ]),
    branchId: Type.Union([uuid, Type.Null()]),
    desired: Type.Union([
      Type.Object(
        {
          publicationId: uuid,
          generation: Type.Integer({ minimum: 1 }),
          protocol: Type.Integer({ minimum: 1 }),
          manifestSha256: sha256Hex,
          manifestSize: Type.Integer({ minimum: 1 }),
          source,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    authorization: Type.Union([Type.String(), Type.Null()]),
    nextSyncSeconds: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const keySetSchema = Type.Object(
  {
    keys: Type.Array(
      Type.Object(
        {
          kty: Type.Literal("EC"),
          crv: Type.Literal("P-256"),
          x: Type.String(),
          y: Type.String(),
          kid: Type.String(),
          use: Type.Literal("sig"),
          alg: Type.Literal("ES256"),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const publicationOperations: readonly ApiOperation[] = [
  ...programOperations("group"),
  ...programOperations("device"),
  {
    method: "GET",
    url: "/companies/:companyId/devices/:deviceId/sync-state",
    operationId: "getDeviceSyncState",
    access: "session",
    description:
      "One screen's synchronization: connection from its last sync (online up to 90 seconds, then without recent contact, offline after 120), its desired publication and what it last reported as received, staged and active. Reported values are the screen's own statements. Needs devices.view on the screen's branch.",
    schema: {
      params: deviceParams,
      response: { 200: screenStateSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "GET",
    url: "/companies/:companyId/publications/screen-states",
    operationId: "listScreenStates",
    access: "session",
    description:
      "The synchronization of up to 100 named screens, for lists; screens the caller may not view (devices.view) or that are unlinked are omitted.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        {
          deviceId: Type.Array(uuid, { minItems: 1, maxItems: 100 }),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          { items: Type.Array(screenStateSchema) },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...session, "RESOURCE_NOT_FOUND", "COMPANY_SUSPENDED"],
  },
  {
    method: "POST",
    url: "/device/sync",
    operationId: "syncDevice",
    access: "device",
    description:
      "Every 30 seconds: the screen reports what it received, staged and activated, and receives the protocol both sides support (2 for players that support it), its status, time zone with that zone's UTC offsets, configured rotation, branch (for branch prices in protocol 2 catalogs), desired publication with its manifest protocol (null for a source without one, which means neutral output; a protocol the player lacks means it reports INCOMPATIBLE and keeps its generation) and a signed authorization statement listing the manifests it may play until the statement expires. A suspended company receives neither a desired publication nor a statement; an unlinked screen must clear itself.",
    schema: {
      body: reportSchema,
      response: { 200: syncSchema, ...common },
    },
    expectedErrors: [...device, "PROTOCOL_UNSUPPORTED"],
  },
  {
    method: "GET",
    url: "/device/publications/:publicationId/manifest",
    operationId: "getDeviceManifest",
    access: "device",
    binaryResponse: true,
    description:
      "The exact manifest bytes (UTF-8 JSON) of the screen's current desired publication; their SHA-256 is the one the statement lists. Any other publication answers RESOURCE_NOT_FOUND, after which the screen synchronizes again.",
    schema: {
      params: Type.Object(
        { publicationId: uuid },
        { additionalProperties: false },
      ),
      response: { 200: binary, ...common },
    },
    expectedErrors: [...device, "RESOURCE_NOT_FOUND"],
  },
  {
    method: "GET",
    url: "/device/media/:mediaId",
    operationId: "getDeviceMedia",
    access: "device",
    binaryResponse: true,
    description:
      "The display rendition of a media item of the screen's current desired publication, with a single byte range for resuming. The strong ETag is the rendition's SHA-256, which the screen verifies with the length against the manifest. At most two downloads per screen at once.",
    schema: {
      params: Type.Object({ mediaId: uuid }, { additionalProperties: false }),
      response: {
        200: binary,
        206: binary,
        416: errorEnvelopeSchema,
        ...common,
      },
    },
    expectedErrors: [...device, "RESOURCE_NOT_FOUND"],
  },
  {
    method: "GET",
    url: "/device/keys",
    operationId: "getDeviceKeys",
    access: "device",
    description:
      "The public keys that verify authorization statements, as a JSON Web Key Set, newest first. The screen pins them after pairing and fetches them again when a statement names an unknown key.",
    schema: {
      response: { 200: keySetSchema, ...common },
    },
    expectedErrors: [...device],
  },
];
