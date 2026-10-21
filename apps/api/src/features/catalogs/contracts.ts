import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";
import type { ApiOperation } from "../../module.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const uuid = Type.String({ pattern: uuidPattern });
const instant = Type.String({ format: "date-time" });
const version = Type.Integer({ minimum: 1 });
const visibleText = "^[^\\u0000-\\u001f\\u007f]*\\S[^\\u0000-\\u001f\\u007f]*$";
const catalogName = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: visibleText,
});
const label = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: visibleText,
});
const decimal = Type.String({
  minLength: 1,
  maxLength: 32,
  pattern: "^[+-]?\\d{1,15}(\\.\\d{1,8})?$",
});
const currency = Type.String({ pattern: "^[A-Z]{3}$" });
// Integer minor units of the field's currency (ADR-0032).
const amount = Type.Integer({ minimum: 0, maximum: 1_000_000_000_000 });
const localMinute = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$",
});
const fieldType = Type.Union([
  Type.Literal("text"),
  Type.Literal("longText"),
  Type.Literal("number"),
  Type.Literal("boolean"),
  Type.Literal("date"),
  Type.Literal("time"),
  Type.Literal("weekdays"),
  Type.Literal("selection"),
  Type.Literal("money"),
  Type.Literal("media"),
  Type.Literal("reference"),
]);
const named = Type.Object(
  { id: uuid, name: Type.String() },
  { additionalProperties: false },
);
// One schema with several types, so request coercion never turns a boolean
// or a number into text: a value keeps whichever listed type it has. Arrays
// come first because the response serializer tries the types in order and
// would otherwise write an array as text.
const fieldValue = Type.Unsafe<string | number | boolean | number[] | null>({
  type: ["array", "boolean", "number", "string", "null"],
  maxLength: 2000,
  items: { type: "integer", minimum: 1, maximum: 7 },
  maxItems: 7,
});
const values = Type.Record(Type.String(), fieldValue, { maxProperties: 60 });

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
const recordMutation = [...mutation, "CATALOG_ARCHIVED"] as const;

const fieldSettings = {
  maxLength: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
  decimals: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
  minimum: Type.Optional(Type.Union([decimal, Type.Null()])),
  maximum: Type.Optional(Type.Union([decimal, Type.Null()])),
  currency: Type.Optional(currency),
  promotions: Type.Optional(Type.Boolean()),
  targetCatalogId: Type.Optional(uuid),
};

export const fieldSchema = Type.Object(
  {
    id: uuid,
    label,
    type: fieldType,
    required: Type.Boolean(),
    archived: Type.Boolean(),
    ...fieldSettings,
    choices: Type.Optional(
      Type.Array(
        Type.Object({ id: uuid, label }, { additionalProperties: false }),
      ),
    ),
  },
  { additionalProperties: false },
);

const fieldInput = Type.Object(
  {
    id: Type.Optional(uuid),
    label,
    type: fieldType,
    required: Type.Optional(Type.Boolean()),
    archived: Type.Optional(Type.Boolean()),
    ...fieldSettings,
    choices: Type.Optional(
      Type.Array(
        Type.Object(
          { id: Type.Optional(uuid), label },
          { additionalProperties: false },
        ),
        { maxItems: 100 },
      ),
    ),
  },
  { additionalProperties: false },
);
const fieldList = Type.Array(fieldInput, { maxItems: 60 });

export const catalogSchema = Type.Object(
  {
    id: uuid,
    name: catalogName,
    branch: Type.Union([named, Type.Null()]),
    status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("ARCHIVED")]),
    fields: Type.Array(fieldSchema),
    recordCount: Type.Integer({ minimum: 0 }),
    schemaVersion: version,
    createdAt: instant,
    updatedAt: instant,
    version,
  },
  { additionalProperties: false },
);

export const recordSchema = Type.Object(
  {
    id: uuid,
    catalogId: uuid,
    title: Type.Union([Type.String(), Type.Null()]),
    available: Type.Boolean(),
    values,
    overrides: Type.Array(
      Type.Object(
        { fieldId: uuid, branch: named, amount },
        { additionalProperties: false },
      ),
    ),
    media: Type.Array(
      Type.Object(
        {
          fieldId: uuid,
          mediaAssetId: uuid,
          name: Type.Union([Type.String(), Type.Null()]),
          status: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    references: Type.Array(
      Type.Object(
        {
          fieldId: uuid,
          recordId: uuid,
          title: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    createdAt: instant,
    updatedAt: instant,
    version,
  },
  { additionalProperties: false },
);

export const promotionSchema = Type.Object(
  {
    id: uuid,
    fieldId: uuid,
    branch: Type.Union([named, Type.Null()]),
    amount,
    startsAt: localMinute,
    endsAt: localMinute,
    createdAt: instant,
  },
  { additionalProperties: false },
);

const effective = {
  amount: Type.Union([amount, Type.Null()]),
  source: Type.Union([
    Type.Literal("promotion"),
    Type.Literal("override"),
    Type.Literal("base"),
    Type.Literal("none"),
  ]),
  promotionId: Type.Union([uuid, Type.Null()]),
};

export const effectivePricesSchema = Type.Object(
  {
    at: localMinute,
    fields: Type.Array(
      Type.Object(
        {
          fieldId: uuid,
          currency,
          scope: Type.Object(effective, { additionalProperties: false }),
          branches: Type.Array(
            Type.Object(
              { branch: named, ...effective },
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

const companyParams = Type.Object(
  { companyId: uuid },
  { additionalProperties: false },
);
const catalogParams = Type.Object(
  { companyId: uuid, catalogId: uuid },
  { additionalProperties: false },
);
const recordParams = Type.Object(
  { companyId: uuid, catalogId: uuid, recordId: uuid },
  { additionalProperties: false },
);
const priceParams = Type.Object(
  { companyId: uuid, catalogId: uuid, recordId: uuid, fieldId: uuid },
  { additionalProperties: false },
);
const versionBody = Type.Object(
  { expectedVersion: version },
  { additionalProperties: false },
);
// A multi-type schema: with anyOf, request coercion would turn null into 0.
const optionalAmount = Type.Unsafe<number | null>({
  type: ["integer", "null"],
  minimum: 0,
  maximum: 1_000_000_000_000,
});
const priceBody = Type.Object(
  { expectedVersion: version, amount: optionalAmount },
  { additionalProperties: false },
);
const cursor = Type.Optional(Type.String({ minLength: 1, maxLength: 1024 }));
const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }));

const schemaReasons =
  "Issue reasons: LABEL_INVALID, LABEL_DUPLICATE, UNKNOWN_FIELD, DUPLICATE_FIELD, TYPE_IMMUTABLE, CURRENCY_IMMUTABLE, TARGET_IMMUTABLE, DECIMALS_IMMUTABLE, SETTING_NOT_APPLICABLE, SETTING_INVALID, CHOICES_INVALID, CURRENCY_UNSUPPORTED, REQUIRED_NOT_ALLOWED, TARGET_INVALID, and with a count of stored items FIELD_HAS_VALUES, REQUIRED_MISSING_VALUES, VALUES_TOO_LONG, VALUES_OUT_OF_RANGE, CHOICE_IN_USE, PROMOTIONS_EXIST and FIELD_BOUND (layouts that bind the field, which can then be neither removed nor archived).";
const fieldRules =
  "Fields: text (maxLength 1-500, 120 by default), longText (1-2,000, 500), number (decimals 0-4, optional minimum and maximum as decimal strings), boolean, date, time, weekdays, selection (1-100 choices with stable IDs), money (an ISO 4217 currency fixed for the field; never required; promotions allowed unless false), media (image items) and reference (a target catalog of the same company that covers this catalog's scope). A field's type, currency, decimals and reference target never change; labels are unique among active fields, ignoring case.";
const recordReasons =
  "Issue reasons: UNKNOWN_FIELD, ARCHIVED_FIELD, PRICE_FIELD, REQUIRED, INVALID_TYPE, CONTROL_CHARACTERS, TOO_LONG, NUMBER_FORMAT, OUT_OF_RANGE, DATE_INVALID, TIME_INVALID, WEEKDAYS_INVALID, CHOICE_UNKNOWN, MEDIA_UNAVAILABLE, MEDIA_NOT_IMAGE, MEDIA_SCOPE, REFERENCE_NOT_FOUND and RECORD_TOO_LARGE.";
const valueRules =
  "Values map field IDs to text, canonical decimal strings with the field's places, booleans, YYYY-MM-DD dates, HH:MM times, weekday lists (1 Monday to 7 Sunday), choice IDs, media IDs or record IDs; null or empty text means absent. Money values are prices, saved through the price operations. At most 16 KiB of values per item.";

export const catalogOperations = [
  {
    method: "GET",
    url: "/companies/:companyId/catalogs",
    operationId: "listCatalogs",
    access: "session",
    description:
      "The company's catalogs the caller may view, newest first: company catalogs for anyone who may view catalogs, and catalogs of granted branches. Filter by scope (company or a branch), name text and status. Cursors are bound to the company, caller, visible scope and filters.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        {
          limit,
          cursor,
          // "company" or a branch ID, as one string so clients get a plain type.
          scope: Type.Optional(
            Type.String({
              pattern: `^(company|${uuidPattern.slice(1, -1)})$`,
            }),
          ),
          text: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
          status: Type.Optional(
            Type.Union([Type.Literal("ACTIVE"), Type.Literal("ARCHIVED")]),
          ),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          {
            items: Type.Array(catalogSchema),
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
    url: "/companies/:companyId/catalogs",
    operationId: "createCatalog",
    access: "session",
    description: `Create a catalog owned by the company (null branch, which needs company-wide authority) or one active branch, optionally with its first fields. The owning scope never changes. ${fieldRules} ${schemaReasons}`,
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          name: catalogName,
          branchId: Type.Union([uuid, Type.Null()]),
          fields: Type.Optional(fieldList),
        },
        { additionalProperties: false },
      ),
      response: { 201: catalogSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "CATALOG_LIMIT_REACHED",
      "CATALOG_SCHEMA_INVALID",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/catalogs/:catalogId",
    operationId: "getCatalog",
    access: "session",
    description:
      "One catalog the caller may view, with its ordered fields and item count.",
    schema: {
      params: catalogParams,
      response: { 200: catalogSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/catalogs/:catalogId",
    operationId: "updateCatalog",
    access: "session",
    description:
      "Rename, archive or restore a catalog with the observed version. An archived catalog is read-only until it is restored.",
    schema: {
      params: catalogParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(catalogName),
          archived: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      response: { 200: catalogSchema, ...common },
    },
    expectedErrors: [...mutation, "CATALOG_ARCHIVED"],
  },
  {
    method: "DELETE",
    url: "/companies/:companyId/catalogs/:catalogId",
    operationId: "deleteCatalog",
    access: "session",
    description:
      "Delete an empty catalog with its fields. A catalog with items answers CATALOG_NOT_EMPTY, and one that another catalog's reference field targets answers CATALOG_IN_USE.",
    schema: {
      params: catalogParams,
      body: versionBody,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...mutation, "CATALOG_NOT_EMPTY", "CATALOG_IN_USE"],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/catalogs/:catalogId/schema",
    operationId: "replaceCatalogSchema",
    access: "session",
    description: `Replace the whole ordered field list with the observed catalog version. Fields keep their IDs; new fields and choices get IDs. Leaving a field out deletes it only while no item or price holds a value for it; archive it instead to keep its values. Making a field required, shortening text, narrowing a number range, removing a choice or disallowing promotions is refused while stored items or promotions would break the rule. ${fieldRules} ${schemaReasons}`,
    schema: {
      params: catalogParams,
      body: Type.Object(
        { expectedVersion: version, fields: fieldList },
        { additionalProperties: false },
      ),
      response: { 200: catalogSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "CATALOG_ARCHIVED",
      "CATALOG_LIMIT_REACHED",
      "CATALOG_SCHEMA_INVALID",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/catalogs/:catalogId/records",
    operationId: "listCatalogRecords",
    access: "session",
    description:
      "A catalog's items in their stored order, optionally only those whose active text fields contain the text. Each item carries its title (the first active text field), the branch prices the caller may view, and the media and items it names. Cursors are bound to the company, caller, catalog and text.",
    schema: {
      params: catalogParams,
      querystring: Type.Object(
        {
          limit,
          cursor,
          text: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          {
            items: Type.Array(recordSchema),
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
    url: "/companies/:companyId/catalogs/:catalogId/records",
    operationId: "createCatalogRecord",
    access: "session",
    description: `Add an item at the end of the catalog, available unless chosen otherwise. ${valueRules} New media must be ready image items of the company or of the catalog's branch; references must name items of the field's target catalog. ${recordReasons}`,
    schema: {
      params: catalogParams,
      body: Type.Object(
        { values, available: Type.Optional(Type.Boolean()) },
        { additionalProperties: false },
      ),
      response: { 201: recordSchema, ...common },
    },
    expectedErrors: [
      ...recordMutation,
      "CATALOG_LIMIT_REACHED",
      "CATALOG_RECORD_INVALID",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId",
    operationId: "getCatalogRecord",
    access: "session",
    description: "One item of a catalog the caller may view.",
    schema: {
      params: recordParams,
      response: { 200: recordSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId",
    operationId: "updateCatalogRecord",
    access: "session",
    description: `Replace an item's values (every active field except money; archived fields and prices keep theirs) and/or set its availability, with the observed item version. ${valueRules} ${recordReasons}`,
    schema: {
      params: recordParams,
      body: Type.Object(
        {
          expectedVersion: version,
          values: Type.Optional(values),
          available: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      response: { 200: recordSchema, ...common },
    },
    expectedErrors: [...recordMutation, "CATALOG_RECORD_INVALID"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId/move",
    operationId: "moveCatalogRecord",
    access: "session",
    description:
      "Place an item right after another item of the same catalog, or first when afterRecordId is null, with the observed item version.",
    schema: {
      params: recordParams,
      body: Type.Object(
        {
          expectedVersion: version,
          afterRecordId: Type.Union([uuid, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      response: { 200: recordSchema, ...common },
    },
    expectedErrors: [...recordMutation],
  },
  {
    method: "DELETE",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId",
    operationId: "deleteCatalogRecord",
    access: "session",
    description:
      "Delete an item with its prices and promotions. An item that other items refer to answers CATALOG_RECORD_REFERENCED with a REFERRED_BY_RECORDS issue counting them.",
    schema: {
      params: recordParams,
      body: versionBody,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...recordMutation, "CATALOG_RECORD_REFERENCED"],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId/prices/:fieldId",
    operationId: "setCatalogBasePrice",
    access: "session",
    description:
      "Set or clear (null) the base price of an item's active money field, in the field currency's minor units, with the observed item version. Needs the prices capability over the catalog's scope and strong authentication; the change is audited with the old and new amounts. Screens show the change through automatic price publication: every program whose latest publication shows the catalog and reaches the change (a branch price or branch promotion only programs reaching that branch) gets a new generation with the catalog's current prices, so the caller also needs publications.publish on each such program; otherwise the change answers PRICE_TARGET_FORBIDDEN and nothing is saved.",
    schema: {
      params: priceParams,
      body: priceBody,
      response: { 200: recordSchema, ...common },
    },
    expectedErrors: [...recordMutation, "PRICE_TARGET_FORBIDDEN"],
  },
  {
    method: "PUT",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId/prices/:fieldId/branches/:branchId",
    operationId: "setCatalogBranchPrice",
    access: "session",
    description:
      "Set or clear (null) one branch's price of a company catalog's item, replacing the base price there, with the observed item version. Needs the prices capability on that branch and strong authentication. Screens show the change through automatic price publication: every program whose latest publication shows the catalog and reaches the change (a branch price or branch promotion only programs reaching that branch) gets a new generation with the catalog's current prices, so the caller also needs publications.publish on each such program; otherwise the change answers PRICE_TARGET_FORBIDDEN and nothing is saved.",
    schema: {
      params: Type.Object(
        {
          companyId: uuid,
          catalogId: uuid,
          recordId: uuid,
          fieldId: uuid,
          branchId: uuid,
        },
        { additionalProperties: false },
      ),
      body: priceBody,
      response: { 200: recordSchema, ...common },
    },
    expectedErrors: [...recordMutation, "PRICE_TARGET_FORBIDDEN"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId/prices/:fieldId/promotions",
    operationId: "listCatalogPromotions",
    access: "session",
    description:
      "Promotions of an item's money field that the caller may view (scope-wide ones and those of visible branches), by start.",
    schema: {
      params: priceParams,
      response: {
        200: Type.Object(
          { items: Type.Array(promotionSchema) },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...scoped],
  },
  {
    method: "POST",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId/prices/:fieldId/promotions",
    operationId: "createCatalogPromotion",
    access: "session",
    description:
      "Add a promotional price for local times [startsAt, endsAt), evaluated in each screen's time zone, for the catalog's whole scope (null branch) or one branch of a company catalog. A promotion of the same price whose window overlaps and whose branches intersect answers CATALOG_PROMOTION_CONFLICT. Needs the prices capability on the scope it affects and strong authentication. At most 100 promotions per price. Screens show the change through automatic price publication: every program whose latest publication shows the catalog and reaches the change (a branch price or branch promotion only programs reaching that branch) gets a new generation with the catalog's current prices, so the caller also needs publications.publish on each such program; otherwise the change answers PRICE_TARGET_FORBIDDEN and nothing is saved.",
    schema: {
      params: priceParams,
      body: Type.Object(
        {
          branchId: Type.Union([uuid, Type.Null()]),
          amount,
          startsAt: localMinute,
          endsAt: localMinute,
        },
        { additionalProperties: false },
      ),
      response: { 201: promotionSchema, ...common },
    },
    expectedErrors: [
      ...recordMutation,
      "CATALOG_PROMOTION_CONFLICT",
      "CATALOG_LIMIT_REACHED",
      "PRICE_TARGET_FORBIDDEN",
    ],
  },
  {
    method: "DELETE",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId/prices/:fieldId/promotions/:promotionId",
    operationId: "deleteCatalogPromotion",
    access: "session",
    description:
      "Remove a promotion. Promotions are never edited; remove one and add another to change it. Screens show the change through automatic price publication: every program whose latest publication shows the catalog and reaches the change (a branch price or branch promotion only programs reaching that branch) gets a new generation with the catalog's current prices, so the caller also needs publications.publish on each such program; otherwise the change answers PRICE_TARGET_FORBIDDEN and nothing is saved.",
    schema: {
      params: Type.Object(
        {
          companyId: uuid,
          catalogId: uuid,
          recordId: uuid,
          fieldId: uuid,
          promotionId: uuid,
        },
        { additionalProperties: false },
      ),
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...recordMutation, "PRICE_TARGET_FORBIDDEN"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/catalogs/:catalogId/records/:recordId/effective-prices",
    operationId: "getCatalogEffectivePrices",
    access: "session",
    description:
      "The price each active money field of an item shows at a local minute: a promotion in effect, then the branch price, then the base price. Gives the whole scope's price and, for each visible branch with its own price or promotion, that branch's.",
    schema: {
      params: recordParams,
      querystring: Type.Object(
        { at: localMinute },
        { additionalProperties: false },
      ),
      response: { 200: effectivePricesSchema, ...common },
    },
    expectedErrors: [...scoped],
  },
] as const satisfies readonly ApiOperation[];
