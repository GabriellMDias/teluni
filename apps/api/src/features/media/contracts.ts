import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";
import type { ApiOperation } from "../../module.js";
import { declaredTypes } from "./domain.js";

const uuid = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
const instant = Type.String({ format: "date-time" });
const version = Type.Integer({ minimum: 1 });
const mediaName = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: "^[^\\u0000-\\u001f\\u007f]*\\S[^\\u0000-\\u001f\\u007f]*$",
});
const tag = Type.String({
  minLength: 1,
  maxLength: 40,
  pattern: "^[^\\u0000-\\u001f\\u007f]*\\S[^\\u0000-\\u001f\\u007f]*$",
});
const tags = Type.Array(tag, { maxItems: 10 });
const kind = Type.Union([Type.Literal("IMAGE"), Type.Literal("VIDEO")]);
const status = Type.Union([
  Type.Literal("UPLOADING"),
  Type.Literal("PROCESSING"),
  Type.Literal("READY"),
  Type.Literal("REJECTED"),
  Type.Literal("FAILED"),
  Type.Literal("ARCHIVED"),
  Type.Literal("DELETED"),
]);
const rejection = Type.Union([
  Type.Literal("MEDIA_TYPE_MISMATCH"),
  Type.Literal("MEDIA_TYPE_UNSUPPORTED"),
  Type.Literal("MEDIA_TOO_LARGE"),
  Type.Literal("MEDIA_DIMENSIONS_EXCEEDED"),
  Type.Literal("MEDIA_DURATION_EXCEEDED"),
  Type.Literal("MEDIA_UNREADABLE"),
  Type.Literal("MEDIA_CONVERSION_FAILED"),
]);
const contentType = Type.Union(
  Object.keys(declaredTypes).map((value) => Type.Literal(value)),
);
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
] as const;
const mutation = [
  ...scoped,
  "CSRF_VALIDATION_FAILED",
  "RESOURCE_VERSION_CONFLICT",
] as const;

export const mediaSchema = Type.Object(
  {
    id: uuid,
    name: mediaName,
    tags,
    kind,
    status,
    rejectionReason: Type.Union([rejection, Type.Null()]),
    branch: Type.Union([
      Type.Object(
        { id: uuid, name: Type.String() },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    declaredContentType: contentType,
    declaredSize: Type.Integer({ minimum: 1 }),
    width: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    height: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    durationMs: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    hasAudio: Type.Union([Type.Boolean(), Type.Null()]),
    processing: Type.Union([
      Type.Object(
        {
          stage: Type.Union([
            Type.Literal("queued"),
            Type.Literal("probing"),
            Type.Literal("converting"),
            Type.Literal("verifying"),
          ]),
          progress: Type.Union([
            Type.Integer({ minimum: 0, maximum: 100 }),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    createdAt: instant,
    readyAt: Type.Union([instant, Type.Null()]),
    archivedAt: Type.Union([instant, Type.Null()]),
    deletedAt: Type.Union([instant, Type.Null()]),
    purgeAfter: Type.Union([instant, Type.Null()]),
    version,
  },
  { additionalProperties: false },
);

const companyParams = Type.Object(
  { companyId: uuid },
  { additionalProperties: false },
);
const mediaParams = Type.Object(
  { companyId: uuid, assetId: uuid },
  { additionalProperties: false },
);
const versionBody = Type.Object(
  { expectedVersion: version },
  { additionalProperties: false },
);

export const mediaOperations = [
  {
    method: "GET",
    url: "/companies/:companyId/media",
    operationId: "listMedia",
    access: "session",
    description:
      "The company's media items the caller may view, newest first: company-wide items and items of granted branches. The library view shows uploads in progress, ready, rejected and failed items; archived shows archived items; trash (company deletion authority only) shows deleted items until their purge; selectable shows ready items only. Filter by kind, scope (company or a branch), tag and name text. Cursors are bound to the company, caller, visible scope and filters.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        {
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
          view: Type.Optional(
            Type.Union([
              Type.Literal("library"),
              Type.Literal("archived"),
              Type.Literal("trash"),
              Type.Literal("selectable"),
            ]),
          ),
          kind: Type.Optional(kind),
          // "company" or a branch ID, as one string so clients get a plain type.
          scope: Type.Optional(
            Type.String({
              pattern:
                "^(company|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$",
            }),
          ),
          tag: Type.Optional(tag),
          text: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          {
            items: Type.Array(mediaSchema),
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
    url: "/companies/:companyId/media",
    operationId: "createMedia",
    access: "session",
    description:
      "Admit an upload before sending its bytes: a name, the owning branch (null for the whole company, which needs company-wide upload authority), the declared type and exact size. Images may have up to 20 MiB and videos up to 1 GiB. The item starts UPLOADING; send the file with uploadMediaContent within one hour.",
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          name: mediaName,
          branchId: Type.Union([uuid, Type.Null()]),
          contentType,
          size: Type.Integer({ minimum: 1 }),
          tags: Type.Optional(tags),
        },
        { additionalProperties: false },
      ),
      response: { 201: mediaSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "MEDIA_TYPE_UNSUPPORTED",
      "MEDIA_TOO_LARGE",
      "MEDIA_STORAGE_FULL",
    ],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/media/:assetId/content",
    operationId: "uploadMediaContent",
    access: "session",
    description:
      "Stream the file of an item in UPLOADING as application/octet-stream, with a Content-Length equal to the declared size. A shorter or longer body, or a broken connection, answers MEDIA_UPLOAD_INCOMPLETE and the same request can be repeated. A complete upload moves the item to PROCESSING, where the server inspects and converts it.",
    bodyContentType: "application/octet-stream",
    schema: {
      params: mediaParams,
      body: binary,
      response: { 200: mediaSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "MEDIA_UPLOAD_INCOMPLETE",
      "MEDIA_NOT_UPLOADING",
      "MEDIA_STORAGE_FULL",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/media/:assetId",
    operationId: "getMedia",
    access: "session",
    description:
      "One media item the caller may view, with its processing state while it is prepared. Items outside the caller's branches answer RESOURCE_NOT_FOUND.",
    schema: {
      params: mediaParams,
      response: { 200: mediaSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "GET",
    url: "/companies/:companyId/media/:assetId/content",
    operationId: "getMediaContent",
    access: "session",
    binaryResponse: true,
    description:
      "Stream a variant of a media item: the thumbnail, the display rendition that screens play, or the original upload (which needs upload authority on the item). Supports a single byte range and revalidation with the strong ETag. Responses are private and sandboxed.",
    schema: {
      params: mediaParams,
      querystring: Type.Object(
        {
          variant: Type.Union([
            Type.Literal("thumbnail"),
            Type.Literal("display"),
            Type.Literal("original"),
          ]),
        },
        { additionalProperties: false },
      ),
      response: {
        200: binary,
        206: binary,
        304: Type.Null(),
        416: errorEnvelopeSchema,
        ...common,
      },
    },
    expectedErrors: [...scoped, "MEDIA_NOT_READY"],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/media/:assetId",
    operationId: "updateMedia",
    access: "session",
    description:
      "Rename or retag a media item with the observed version. Tags are stored trimmed, lower-case and sorted, at most ten.",
    schema: {
      params: mediaParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(mediaName),
          tags: Type.Optional(tags),
        },
        { additionalProperties: false },
      ),
      response: { 200: mediaSchema, ...common },
    },
    expectedErrors: [...mutation, "MEDIA_INVALID_STATE"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/media/:assetId/archive",
    operationId: "archiveMedia",
    access: "session",
    description:
      "Archive a ready item: it leaves selection lists and keeps working wherever it is already used.",
    schema: {
      params: mediaParams,
      body: versionBody,
      response: { 200: mediaSchema, ...common },
    },
    expectedErrors: [...mutation, "MEDIA_INVALID_STATE"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/media/:assetId/restore",
    operationId: "restoreMedia",
    access: "session",
    description: "Return an archived item to the library.",
    schema: {
      params: mediaParams,
      body: versionBody,
      response: { 200: mediaSchema, ...common },
    },
    expectedErrors: [...mutation, "MEDIA_INVALID_STATE"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/media/:assetId/delete",
    operationId: "deleteMedia",
    access: "session",
    description:
      "Move an archived item to the trash, where it stays restorable for 30 days before its files are purged. Items still protected by programming or publications answer MEDIA_IN_USE and nothing changes. Company administrators only.",
    schema: {
      params: mediaParams,
      body: versionBody,
      response: { 200: mediaSchema, ...common },
    },
    expectedErrors: [...mutation, "MEDIA_INVALID_STATE", "MEDIA_IN_USE"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/media/:assetId/restore-deleted",
    operationId: "restoreDeletedMedia",
    access: "session",
    description:
      "Take an item out of the trash before its purge; it returns archived. Company administrators only.",
    schema: {
      params: mediaParams,
      body: versionBody,
      response: { 200: mediaSchema, ...common },
    },
    expectedErrors: [...mutation, "MEDIA_INVALID_STATE"],
  },
  {
    method: "DELETE",
    url: "/companies/:companyId/media/:assetId",
    operationId: "discardMedia",
    access: "session",
    description:
      "Discard an item that never became usable (still uploading, rejected or failed); its files are deleted at once.",
    schema: {
      params: mediaParams,
      body: versionBody,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...mutation, "MEDIA_INVALID_STATE"],
  },
] as const satisfies readonly ApiOperation[];
