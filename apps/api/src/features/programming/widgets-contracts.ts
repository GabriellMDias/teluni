import { errorEnvelopeSchema } from "../../errors.js";
import type { ApiOperation } from "../../module.js";
import { Type } from "typebox";
const style = {
  version: Type.Literal(1),
  locale: Type.Union([Type.Literal("pt-BR"), Type.Literal("en-US")]),
  textSize: Type.Integer({ minimum: 24, maximum: 200 }),
  foreground: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
};
const publicUrl = Type.String({ minLength: 9, maxLength: 2048 });
const string = (maxLength: number, minLength = 1) =>
  Type.String({ minLength, maxLength });
const object = <T extends Record<string, import("typebox").TSchema>>(
  properties: T,
) => Type.Object({ ...style, ...properties }, { additionalProperties: false });
export const widgetSchema = Type.Union([
  object({
    type: Type.Literal("clock"),
    showTime: Type.Boolean(),
    showDate: Type.Boolean(),
    seconds: Type.Boolean(),
    hour12: Type.Boolean(),
    dateStyle: Type.Union([Type.Literal("short"), Type.Literal("long")]),
  }),
  object({
    type: Type.Literal("qr"),
    targetUrl: publicUrl,
    caption: string(120, 0),
  }),
  object({
    type: Type.Literal("ticker"),
    text: string(2000),
    speed: Type.Integer({ minimum: 20, maximum: 160 }),
  }),
  object({
    type: Type.Literal("weather"),
    latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }),
    label: string(80),
    units: Type.Union([Type.Literal("celsius"), Type.Literal("fahrenheit")]),
  }),
  object({
    type: Type.Literal("rss"),
    feedUrl: publicUrl,
    title: string(80),
    itemSeconds: Type.Integer({ minimum: 5, maximum: 120 }),
    maxItems: Type.Integer({ minimum: 1, maximum: 20 }),
  }),
]);
export const widgetDataSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("ready"),
      Type.Literal("stale"),
      Type.Literal("unavailable"),
    ]),
    fetchedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    validUntil: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    data: Type.Union([
      Type.Object(
        {
          type: Type.Literal("weather"),
          temperatureC: Type.Number(),
          humidity: Type.Number(),
          symbol: string(64),
          forecastAt: Type.String({ format: "date-time" }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal("rss"),
          source: string(120),
          items: Type.Array(
            Type.Object(
              { title: string(200), url: Type.Union([publicUrl, Type.Null()]) },
              { additionalProperties: false },
            ),
            { maxItems: 20 },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const uuid = Type.String({ format: "uuid" });
const linkId = Type.String({ pattern: "^[0-9a-f]{32}$" });
const snapshotSchema = Type.Union(
  widgetSchema.anyOf.map((variant) =>
    Type.Object(
      {
        ...variant.properties,
        layoutId: Type.Optional(uuid),
        linkId: Type.Optional(linkId),
        qrUrl: Type.Optional(Type.String({ maxLength: 2048 })),
        modules: Type.Optional(
          Type.Array(Type.String({ pattern: "^[01]{21,177}$" }), {
            minItems: 21,
            maxItems: 177,
          }),
        ),
      },
      { additionalProperties: false },
    ),
  ),
);
export const widgetOperations = [
  {
    method: "POST",
    url: "/companies/:companyId/programming/widgets/preview",
    operationId: "previewLayoutWidget",
    access: "session",
    description:
      "Preview a validated widget configuration. Requires programming.edit over the selected branch (company-wide when null). Weather (MET Norway, CC BY 4.0) and public HTTPS RSS/Atom headlines are fetched by the server with bounded caching and safe outbound networking. A QR preview does not activate its destination; publishing does.",
    schema: {
      params: Type.Object({ companyId: uuid }, { additionalProperties: false }),
      body: Type.Object(
        {
          widget: widgetSchema,
          layoutId: uuid,
          areaKey: Type.String({ pattern: "^[a-z][a-z0-9-]{0,15}$" }),
          branchId: Type.Union([uuid, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          { widget: snapshotSchema, live: widgetDataSchema },
          { additionalProperties: false },
        ),
        400: errorEnvelopeSchema,
        401: errorEnvelopeSchema,
        403: errorEnvelopeSchema,
        404: errorEnvelopeSchema,
        409: errorEnvelopeSchema,
        429: errorEnvelopeSchema,
        503: errorEnvelopeSchema,
        500: errorEnvelopeSchema,
      },
    },
    expectedErrors: [
      "AUTHENTICATION_REQUIRED",
      "SESSION_LIMIT_REACHED",
      "RATE_LIMITED",
      "SERVICE_UNAVAILABLE",
      "VALIDATION_FAILED",
      "RESOURCE_NOT_FOUND",
      "COMPANY_SUSPENDED",
      "PERMISSION_DENIED",
      "CSRF_VALIDATION_FAILED",
      "LAYOUT_INVALID",
    ],
  },
  {
    method: "GET",
    url: "/q/:linkId",
    operationId: "getPublishedQrDestination",
    access: "public",
    description:
      "Resolve an opaque published QR link to its current HTTPS destination. Public by design; returns no company, layout or membership information. Draft saves never change this destination. Deleting the layout or suspending its company makes the link unavailable.",
    schema: {
      params: Type.Object({ linkId }, { additionalProperties: false }),
      response: {
        200: Type.Object({ url: publicUrl }, { additionalProperties: false }),
        400: errorEnvelopeSchema,
        404: errorEnvelopeSchema,
        409: errorEnvelopeSchema,
        429: errorEnvelopeSchema,
        500: errorEnvelopeSchema,
      },
    },
    expectedErrors: ["RESOURCE_NOT_FOUND", "RATE_LIMITED", "VALIDATION_FAILED"],
  },
] as const satisfies readonly ApiOperation[];
