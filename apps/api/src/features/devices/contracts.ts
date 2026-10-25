import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";

const uuid = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
const instant = Type.String({ format: "date-time" });
const version = Type.Integer({ minimum: 1 });
const printable = (maxLength: number) =>
  Type.String({
    minLength: 1,
    maxLength,
    pattern: "^[^\\u0000-\\u001f\\u007f]+$",
  });
const encoded32 = Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" });
const rotation = Type.Union([
  Type.Literal(0),
  Type.Literal(90),
  Type.Literal(180),
  Type.Literal(270),
]);
const deviceName = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: ".*\\S.*",
});
const deviceStatus = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("REVOKED"),
]);
const timeZone = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "^[A-Za-z][A-Za-z0-9_+/-]*$",
});
const erasure = Type.Union([
  Type.Literal("NONE"),
  Type.Literal("PENDING"),
  Type.Literal("CONFIRMED"),
  Type.Literal("RESET_RECORDED"),
]);

export const reportSchema = Type.Object(
  {
    appVersion: printable(40),
    protocolVersion: Type.Integer({ minimum: 1, maximum: 1000 }),
    manufacturer: printable(80),
    model: printable(80),
    osVersion: printable(40),
    display: Type.Object(
      {
        width: Type.Integer({ minimum: 1, maximum: 16384 }),
        height: Type.Integer({ minimum: 1, maximum: 16384 }),
      },
      { additionalProperties: false },
    ),
    rotations: Type.Array(rotation, { minItems: 1, maxItems: 4 }),
  },
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
const device = [
  "DEVICE_UNAUTHORIZED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "VALIDATION_FAILED",
] as const;

export const deviceSchema = Type.Object(
  {
    id: uuid,
    name: deviceName,
    branch: Type.Object(
      { id: uuid, name: Type.String(), timeZone: Type.String() },
      { additionalProperties: false },
    ),
    timeZone: Type.Union([timeZone, Type.Null()]),
    rotation,
    status: deviceStatus,
    erasure,
    report: reportSchema,
    lastSeenAt: Type.Union([instant, Type.Null()]),
    pairedAt: instant,
    revokedAt: Type.Union([instant, Type.Null()]),
    erasureRecordedAt: Type.Union([instant, Type.Null()]),
    version,
  },
  { additionalProperties: false },
);
const companyParams = Type.Object(
  { companyId: uuid },
  { additionalProperties: false },
);
const deviceParams = Type.Object(
  { companyId: uuid, deviceId: uuid },
  { additionalProperties: false },
);
const enrollmentParams = Type.Object(
  { enrollmentId: uuid },
  { additionalProperties: false },
);
const versionBody = Type.Object(
  { expectedVersion: version },
  { additionalProperties: false },
);

export const deviceOperations = [
  {
    method: "POST",
    url: "/device-enrollments",
    operationId: "startDeviceEnrollment",
    access: "public",
    description:
      "Start pairing a screen. The player sends the SHA-256 of a 256-bit credential it generated and keeps, and its report; the answer carries the code to show (XXXX-XXXX, valid ten minutes, single use) and the enrollment to poll. A hash already bound to a device or an enrollment answers ENROLLMENT_REJECTED. Limited per client address and by the number of pending enrollments.",
    schema: {
      body: Type.Object(
        { credentialHash: encoded32, report: reportSchema },
        { additionalProperties: false },
      ),
      response: {
        201: Type.Object(
          {
            enrollmentId: uuid,
            userCode: Type.String({ pattern: "^[A-Z]{4}-[A-Z]{4}$" }),
            expiresAt: instant,
            pollIntervalSeconds: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [
      "RATE_LIMITED",
      "SERVICE_UNAVAILABLE",
      "VALIDATION_FAILED",
      "ENROLLMENT_REJECTED",
    ],
  },
  {
    method: "POST",
    url: "/device-enrollments/:enrollmentId/status",
    operationId: "getDeviceEnrollmentStatus",
    access: "device",
    description:
      "Poll an enrollment with the credential whose hash started it, at most once per polling interval. Answers pending, paired with the device ID, or expired. Polling too fast answers RATE_LIMITED with Retry-After.",
    schema: {
      params: enrollmentParams,
      response: {
        200: Type.Object(
          {
            status: Type.Union([
              Type.Literal("pending"),
              Type.Literal("paired"),
              Type.Literal("expired"),
            ]),
            deviceId: Type.Union([uuid, Type.Null()]),
            pollIntervalSeconds: Type.Integer({ minimum: 1 }),
          },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...device],
  },
  {
    method: "GET",
    url: "/device/self",
    operationId: "getDeviceSelf",
    access: "device",
    description:
      "The calling screen's configuration, including the time zone that schedules use: its explicit zone, otherwise its branch's. An active screen receives authorizedUntil, seven days after this successful renewal (AT-15), which it must stop protected playback at. An unlinked screen learns only that it must clear its private content and credential, then confirm the erasure. A screen of a suspended company receives no renewal.",
    schema: {
      response: {
        200: Type.Object(
          {
            id: uuid,
            status: Type.Union([
              Type.Literal("active"),
              Type.Literal("suspended"),
              Type.Literal("unlinked"),
            ]),
            clearRequired: Type.Boolean(),
            name: Type.Union([deviceName, Type.Null()]),
            branch: Type.Union([
              Type.Object(
                { id: uuid, name: Type.String(), timeZone: Type.String() },
                { additionalProperties: false },
              ),
              Type.Null(),
            ]),
            timeZone: Type.Union([Type.String(), Type.Null()]),
            rotation: Type.Union([rotation, Type.Null()]),
            authorizedUntil: Type.Union([instant, Type.Null()]),
            serverTime: instant,
          },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...device],
  },
  {
    method: "PUT",
    url: "/device/self/report",
    operationId: "updateDeviceReport",
    access: "device",
    description:
      "Replace the active screen's report of its application, model, display and supported rotations. Reports are device statements, not qualified support.",
    schema: {
      body: reportSchema,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...device],
  },
  {
    method: "POST",
    url: "/device/self/erasure",
    operationId: "confirmDeviceErasure",
    access: "device",
    description:
      "Confirm, as an unlinked screen, that private content, configuration and the credential were cleared. The server deletes the credential hash, so repeating the call answers DEVICE_UNAUTHORIZED, which the player treats as done.",
    schema: {
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...device],
  },
  {
    method: "POST",
    url: "/device/self/credential",
    operationId: "rotateDeviceCredential",
    access: "device",
    description:
      "Register the hash of a new device-generated credential. The current credential keeps working until the new one is first used, so a lost response is safe; repeating the same hash is harmless.",
    schema: {
      body: Type.Object(
        { credentialHash: encoded32 },
        { additionalProperties: false },
      ),
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...device, "ENROLLMENT_REJECTED"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/devices",
    operationId: "listDevices",
    access: "session",
    description:
      "The company's screens the caller may view, newest pairing first: every screen for company-wide access, otherwise those in granted branches. Filter by branch or status. Cursors are bound to the company, caller, visible scope and filters.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        {
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
          branchId: Type.Optional(uuid),
          status: Type.Optional(deviceStatus),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          {
            items: Type.Array(deviceSchema),
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
    method: "GET",
    url: "/companies/:companyId/devices/:deviceId",
    operationId: "getDevice",
    access: "session",
    description:
      "One screen the caller may view. Screens outside the caller's branches answer RESOURCE_NOT_FOUND.",
    schema: {
      params: deviceParams,
      response: { 200: deviceSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "GET",
    url: "/companies/:companyId/devices/:deviceId/audit-events",
    operationId: "listDeviceAuditEvents",
    access: "session",
    description:
      "Lifecycle history of a currently visible screen, newest first by event time and ID. Requires audit access and its assurance. Company administrators see every event; other auditors see only events with known immutable scope entirely within their audit branches, including both sides of a move. Legacy unknown-scope events remain administrator-only. Authorization precedes pagination; cursors bind company, person, device and current audit scope. Returns only action, time and actor ID, never private audit details or credentials.",
    schema: {
      params: deviceParams,
      querystring: Type.Object(
        {
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          {
            items: Type.Array(
              Type.Object(
                {
                  id: uuid,
                  occurredAt: instant,
                  actorPrincipalId: Type.Union([uuid, Type.Null()]),
                  action: Type.String({ maxLength: 64 }),
                },
                { additionalProperties: false },
              ),
            ),
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
    url: "/companies/:companyId/devices",
    operationId: "pairDevice",
    access: "session",
    description:
      "Pair the screen showing a code to an active branch the caller manages, with a name and one of the rotations the screen reported. Expired, used, unknown and concurrently claimed codes all answer PAIRING_CODE_INVALID; repeated failures answer RATE_LIMITED. Requires screen management and two-step verification.",
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          userCode: Type.String({ minLength: 1, maxLength: 32 }),
          name: deviceName,
          branchId: uuid,
          rotation,
        },
        { additionalProperties: false },
      ),
      response: { 201: deviceSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "PAIRING_CODE_INVALID",
      "ROTATION_UNSUPPORTED",
    ],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/devices/:deviceId",
    operationId: "updateDevice",
    access: "session",
    description:
      "Rename an active screen, change its rotation or set its explicit time zone (null follows the branch) with the observed version. Only rotations the screen reported are accepted.",
    schema: {
      params: deviceParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(deviceName),
          rotation: Type.Optional(rotation),
          timeZone: Type.Optional(Type.Union([timeZone, Type.Null()])),
        },
        { additionalProperties: false },
      ),
      response: { 200: deviceSchema, ...common },
    },
    expectedErrors: [...mutation, "ROTATION_UNSUPPORTED", "DEVICE_UNLINKED"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/devices/:deviceId/move",
    operationId: "moveDevice",
    access: "session",
    description:
      "Move an active screen to another active branch of the same company with the observed version. The caller must manage both branches. Moving to another company is an unlink followed by a new pairing.",
    schema: {
      params: deviceParams,
      body: Type.Object(
        { expectedVersion: version, branchId: uuid },
        { additionalProperties: false },
      ),
      response: { 200: deviceSchema, ...common },
    },
    expectedErrors: [...mutation, "DEVICE_UNLINKED"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/devices/:deviceId/unlink",
    operationId: "unlinkDevice",
    access: "session",
    description:
      "Unlink a screen with the observed version: its credential stops working at once except to learn that it must clear and to confirm the erasure, which stays pending until then. This cannot be undone; the screen is paired again with a new code.",
    schema: {
      params: deviceParams,
      body: versionBody,
      response: { 200: deviceSchema, ...common },
    },
    expectedErrors: [...mutation, "DEVICE_UNLINKED"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/devices/:deviceId/reset-record",
    operationId: "recordDeviceReset",
    access: "session",
    description:
      "Record, for an unlinked screen whose erasure is pending, that it was reset locally. The record stays distinct from an erasure the screen confirmed.",
    schema: {
      params: deviceParams,
      body: versionBody,
      response: { 200: deviceSchema, ...common },
    },
    expectedErrors: [...mutation, "DEVICE_ERASURE_NOT_PENDING"],
  },
] as const;
