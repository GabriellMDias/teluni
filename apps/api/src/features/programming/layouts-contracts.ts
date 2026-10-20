import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";
import type { ApiOperation } from "../../module.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const uuid = Type.String({ pattern: uuidPattern });
const instant = Type.String({ format: "date-time" });
const version = Type.Integer({ minimum: 1 });
const visibleText = "^[^\\u0000-\\u001f\\u007f]*\\S[^\\u0000-\\u001f\\u007f]*$";
const layoutName = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: visibleText,
});
const areaName = Type.String({
  minLength: 1,
  maxLength: 40,
  pattern: visibleText,
});
const areaKey = Type.String({ pattern: "^[a-z][a-z0-9-]{0,15}$" });
const orientation = Type.Union([
  Type.Literal("landscape"),
  Type.Literal("portrait"),
]);
const kind = Type.Union([Type.Literal("media"), Type.Literal("catalog")]);
const fit = Type.Union([Type.Literal("contain"), Type.Literal("cover")]);
const role = Type.Union([
  Type.Literal("title"),
  Type.Literal("subtitle"),
  Type.Literal("price"),
  Type.Literal("image"),
  Type.Literal("detail"),
  Type.Literal("group"),
]);
const presentation = Type.Union([
  Type.Literal("list"),
  Type.Literal("table"),
  Type.Literal("menu"),
  Type.Literal("agenda"),
]);
const unavailable = Type.Union([Type.Literal("hide"), Type.Literal("show")]);
const color = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });
const canvasUnit = Type.Integer({ minimum: 0, maximum: 1920 });
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
const scoped = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_LIMIT_REACHED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "VALIDATION_FAILED",
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

const viewInput = Type.Object(
  {
    catalogId: uuid,
    fields: Type.Array(
      Type.Object({ fieldId: uuid, role }, { additionalProperties: false }),
      { maxItems: 8 },
    ),
    presentation,
    textSize: Type.Integer({ minimum: 1, maximum: 1000 }),
    unavailable: Type.Optional(unavailable),
    pageSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  },
  { additionalProperties: false },
);

const areaInput = Type.Object(
  {
    key: areaKey,
    name: areaName,
    x: canvasUnit,
    y: canvasUnit,
    width: canvasUnit,
    height: canvasUnit,
    z: Type.Integer({ minimum: 0, maximum: 99 }),
    background: Type.Optional(color),
    fit: Type.Optional(fit),
    muted: Type.Optional(Type.Boolean()),
    volume: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    kind,
    pageControlled: Type.Optional(Type.Boolean()),
    view: Type.Optional(Type.Union([viewInput, Type.Null()])),
  },
  { additionalProperties: false },
);

const pageInput = Type.Object(
  {
    durationSeconds: Type.Integer({ minimum: 0, maximum: 100000 }),
    contents: Type.Array(
      Type.Object(
        {
          areaKey: areaKey,
          mediaAssetId: Type.Optional(Type.Union([uuid, Type.Null()])),
          viewPage: Type.Optional(
            Type.Union([
              Type.Integer({ minimum: 1, maximum: 1000 }),
              Type.Null(),
            ]),
          ),
          groupChoiceId: Type.Optional(
            Type.Union([
              Type.String({ minLength: 1, maxLength: 64 }),
              Type.Null(),
            ]),
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 12 },
    ),
  },
  { additionalProperties: false },
);

const definitionFields = {
  orientation,
  audioMixConfirmed: Type.Optional(Type.Boolean()),
  areas: Type.Array(areaInput, { maxItems: 12 }),
  pages: Type.Optional(Type.Array(pageInput, { maxItems: 20 })),
};
export const layoutDefinitionSchema = Type.Object(definitionFields, {
  additionalProperties: false,
});

/** The `teluni.layout` text representation, schema 1. */
export const layoutDocumentSchema = Type.Object(
  {
    format: Type.Literal("teluni.layout"),
    schema: Type.Literal(1),
    name: layoutName,
    orientation,
    audioMixConfirmed: Type.Boolean(),
    areas: Type.Array(areaInput),
    pages: Type.Array(pageInput),
  },
  { additionalProperties: false },
);

// Imports accept any format and schema so that the API can say which one
// it does not support.
const documentInput = Type.Object(
  {
    format: Type.String({ maxLength: 64 }),
    schema: Type.Integer({ minimum: 0, maximum: 1000 }),
    name: layoutName,
    ...definitionFields,
  },
  { additionalProperties: false },
);

const fitSchema = Type.Object(
  {
    areaKey,
    pages: Type.Integer({ minimum: 0 }),
    records: Type.Integer({ minimum: 0 }),
    rowsPerPage: Type.Integer({ minimum: 0 }),
    overflow: Type.Array(
      Type.Object(
        {
          recordId: uuid,
          title: Type.Union([Type.String(), Type.Null()]),
          reason: Type.Union([
            Type.Literal("TITLE_OVERFLOW"),
            Type.Literal("PRICE_OVERFLOW"),
            Type.Literal("DETAIL_OVERFLOW"),
            Type.Literal("ROW_TOO_TALL"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const layoutSchema = Type.Object(
  {
    id: uuid,
    name: layoutName,
    branch: Type.Union([named, Type.Null()]),
    orientation,
    canvas: Type.Object(
      { width: Type.Integer(), height: Type.Integer() },
      { additionalProperties: false },
    ),
    audioMixConfirmed: Type.Boolean(),
    areas: Type.Array(
      Type.Object(
        {
          key: areaKey,
          name: Type.String(),
          x: Type.Integer(),
          y: Type.Integer(),
          width: Type.Integer(),
          height: Type.Integer(),
          z: Type.Integer(),
          background: color,
          fit,
          muted: Type.Boolean(),
          volume: Type.Integer({ minimum: 0, maximum: 100 }),
          kind,
          pageControlled: Type.Boolean(),
          view: Type.Union([
            Type.Object(
              {
                catalog: named,
                fields: Type.Array(
                  Type.Object(
                    {
                      fieldId: uuid,
                      role,
                      label: Type.Union([Type.String(), Type.Null()]),
                      type: Type.Union([Type.String(), Type.Null()]),
                    },
                    { additionalProperties: false },
                  ),
                ),
                presentation,
                textSize: Type.Integer(),
                unavailable,
                pageSeconds: Type.Integer(),
              },
              { additionalProperties: false },
            ),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    pages: Type.Array(
      Type.Object(
        {
          durationSeconds: Type.Integer(),
          suggestedSeconds: Type.Union([Type.Integer(), Type.Null()]),
          contents: Type.Array(
            Type.Object(
              {
                areaKey,
                mediaAssetId: Type.Union([uuid, Type.Null()]),
                media: Type.Union([
                  Type.Object(
                    {
                      name: Type.String(),
                      kind: Type.String(),
                      status: Type.String(),
                      durationMs: Type.Union([Type.Integer(), Type.Null()]),
                    },
                    { additionalProperties: false },
                  ),
                  Type.Null(),
                ]),
                viewPage: Type.Union([Type.Integer(), Type.Null()]),
                groupChoiceId: Type.Union([Type.String(), Type.Null()]),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    fit: Type.Array(fitSchema),
    createdAt: instant,
    updatedAt: instant,
    version,
  },
  { additionalProperties: false },
);

export const layoutSummarySchema = Type.Object(
  {
    id: uuid,
    name: layoutName,
    branch: Type.Union([named, Type.Null()]),
    orientation,
    areaCount: Type.Integer({ minimum: 0 }),
    pageCount: Type.Integer({ minimum: 0 }),
    createdAt: instant,
    updatedAt: instant,
    version,
  },
  { additionalProperties: false },
);

const companyParams = Type.Object(
  { companyId: uuid },
  { additionalProperties: false },
);
const layoutParams = Type.Object(
  { companyId: uuid, layoutId: uuid },
  { additionalProperties: false },
);

const reasons =
  "Issue reasons: AREA_COUNT, KEY_INVALID, KEY_DUPLICATE, NAME_INVALID, GEOMETRY_INVALID, OUTSIDE_CANVAS, STACK_INVALID, STACK_DUPLICATE, COLOR_INVALID, VOLUME_INVALID, NO_PAGES, VIEW_NOT_APPLICABLE, VIEW_REQUIRED, VIEW_COUNT, FIELD_COUNT, FIELD_DUPLICATE, TITLE_REQUIRED, ROLE_REPEATED, PRICE_REQUIRED, GROUP_REQUIRED, TEXT_SIZE_INVALID, PAGE_SECONDS_INVALID, AUDIO_MIX_UNCONFIRMED, PAGE_COUNT, DURATION_INVALID, AREA_NOT_PAGE_CONTROLLED, AREA_DUPLICATE, CONTENT_INVALID, CONTENT_MISSING, CATALOG_UNAVAILABLE, CATALOG_SCOPE, FIELD_UNAVAILABLE, ROLE_TYPE_MISMATCH, MEDIA_UNAVAILABLE, MEDIA_SCOPE, PAGE_SHORTER_THAN_VIDEO, GROUP_UNKNOWN and, for imports, FORMAT_UNSUPPORTED.";
const rules =
  'A layout has a 1920×1080 (landscape) or 1080×1920 (portrait) canvas and 1 to 12 areas with unique keys and stacking orders, at least 40 units wide and high and inside the canvas. Areas start muted; more than one audible area needs audioMixConfirmed. A catalog area (at most 6) shows a view of an active catalog of the company or the layout\'s branch, binding 1 to 8 fields by role (one title; at most one subtitle, price, image and group; a menu needs a price, an agenda a weekdays group), with text size 24 to 200 and automatic pages every 5 to 120 seconds. A layout has no pages or 2 to 20 pages of 1 to 600 seconds, each naming what every page-controlled area shows: a media item of the layout\'s scope no longer than the page, or a view page or group (a selection choice ID, or an agenda\'s weekday from "1" for Monday to "7").';

export const layoutOperations = [
  {
    method: "GET",
    url: "/companies/:companyId/programming/layouts",
    operationId: "listLayouts",
    access: "session",
    description:
      "The company's layouts the caller may view, newest first: company layouts for anyone who may view programming, and layouts of granted branches. Filter by scope (company or a branch) and name text. Cursors are bound to the company, caller, visible scope and filters.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        {
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
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
            items: Type.Array(layoutSummarySchema),
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
    url: "/companies/:companyId/programming/layouts",
    operationId: "createLayout",
    access: "session",
    description: `Create a layout owned by the company (null branch, which needs company-wide authority) or one active branch, with its definition. ${rules} ${reasons}`,
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          name: layoutName,
          branchId: Type.Union([uuid, Type.Null()]),
          definition: layoutDefinitionSchema,
        },
        { additionalProperties: false },
      ),
      response: { 201: layoutSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "LAYOUT_INVALID",
      "PROGRAMMING_LIMIT_REACHED",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/programming/layouts/import",
    operationId: "importLayout",
    access: "session",
    description: `Create a layout from its exported \`teluni.layout\` JSON (schema 1) in the importer's scope. It is validated like any save; catalogs, fields and media the importer cannot use are reported as issues to remap, never kept. ${reasons}`,
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          branchId: Type.Union([uuid, Type.Null()]),
          document: documentInput,
        },
        { additionalProperties: false },
      ),
      response: { 201: layoutSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "LAYOUT_INVALID",
      "PROGRAMMING_LIMIT_REACHED",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/layouts/:layoutId",
    operationId: "getLayout",
    access: "session",
    description:
      "One layout the caller may view, with its areas, catalog views and pages, the seconds that cover each page's longest video, and each catalog view's fit: how many pages its records take and which records overflow (with titles for members who may view the catalog).",
    schema: {
      params: layoutParams,
      response: { 200: layoutSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/programming/layouts/:layoutId",
    operationId: "updateLayout",
    access: "session",
    description: `Rename a layout and/or replace its whole definition with the observed version. Area keys are kept exactly as given and never renamed; an area whose key the definition leaves out is removed. Programs using the layout lose the outputs of removed areas, and the default playlists of areas that become catalog areas; when any holds schedules or a default, the answer is LAYOUT_CHANGE_CONFIRMATION_REQUIRED with one issue per output (OUTPUT_REMOVED or DEFAULT_REMOVED, counting the programs) until confirmRemovedOutputs is true. Catalogs and media the layout already names may stay. ${rules} ${reasons}`,
    schema: {
      params: layoutParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(layoutName),
          definition: Type.Optional(layoutDefinitionSchema),
          confirmRemovedOutputs: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      response: { 200: layoutSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "LAYOUT_INVALID",
      "LAYOUT_CHANGE_CONFIRMATION_REQUIRED",
    ],
  },
  {
    method: "DELETE",
    url: "/companies/:companyId/programming/layouts/:layoutId",
    operationId: "deleteLayout",
    access: "session",
    description:
      "Delete a layout with its areas and pages. A layout that programs use answers LAYOUT_IN_USE.",
    schema: {
      params: layoutParams,
      body: Type.Object(
        { expectedVersion: version },
        { additionalProperties: false },
      ),
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...mutation, "LAYOUT_IN_USE"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/programming/layouts/:layoutId/export",
    operationId: "exportLayout",
    access: "session",
    description:
      "The layout as versioned `teluni.layout` JSON (schema 1), which import accepts. Catalogs, fields and media are named by their IDs.",
    schema: {
      params: layoutParams,
      response: { 200: layoutDocumentSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
] as const satisfies readonly ApiOperation[];
