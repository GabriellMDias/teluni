import { Type } from "typebox";
import { errorEnvelopeSchema } from "../../errors.js";

const uuid = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});
const instant = Type.String({ format: "date-time" });
const version = Type.Integer({ minimum: 1 });
const name = Type.String({ minLength: 1, maxLength: 120, pattern: ".*\\S.*" });
const timeZone = Type.String({ minLength: 1, maxLength: 64 });
const locale = Type.Union([Type.Literal("pt-BR"), Type.Literal("en-US")]);
const role = Type.Union([
  Type.Literal("COMPANY_ADMINISTRATOR"),
  Type.Literal("BRANCH_MANAGER"),
  Type.Literal("OPERATOR"),
]);
const capability = Type.Union([
  Type.Literal("company.view"),
  Type.Literal("company.settings.manage"),
  Type.Literal("branches.view"),
  Type.Literal("branches.manage"),
  Type.Literal("members.manage"),
  Type.Literal("audit.view"),
]);
const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }));
const cursor = Type.Optional(Type.String({ minLength: 1, maxLength: 1024 }));
const companyParams = Type.Object(
  { companyId: uuid },
  { additionalProperties: false },
);
const branchParams = Type.Object(
  { companyId: uuid, branchId: uuid },
  { additionalProperties: false },
);
const memberParams = Type.Object(
  { companyId: uuid, membershipId: uuid },
  { additionalProperties: false },
);
const membershipStatus = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("SUSPENDED"),
  Type.Literal("REMOVED"),
]);
const memberPageSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: uuid,
          principalId: uuid,
          status: membershipStatus,
          version,
          responsible: Type.Boolean(),
          roles: Type.Array(role),
          displayName: Type.Union([Type.String(), Type.Null()]),
          email: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const accessSchema = Type.Object(
  {
    roles: Type.Array(role),
    responsible: Type.Boolean(),
    capabilities: Type.Array(capability),
    capabilitiesAfterStrongAuthentication: Type.Array(capability),
  },
  { additionalProperties: false },
);

export const companySchema = Type.Object(
  {
    id: uuid,
    displayName: name,
    status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("SUSPENDED")]),
    defaultLocale: locale,
    timeZone,
    version,
    createdAt: instant,
    updatedAt: instant,
  },
  { additionalProperties: false },
);

const companyWithAccessSchema = Type.Object(
  { company: companySchema, access: accessSchema },
  { additionalProperties: false },
);

const companyListSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: uuid,
          displayName: name,
          status: Type.Union([
            Type.Literal("ACTIVE"),
            Type.Literal("SUSPENDED"),
          ]),
          roles: Type.Array(role),
        },
        { additionalProperties: false },
      ),
    ),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const branchSchema = Type.Object(
  {
    id: uuid,
    companyId: uuid,
    name,
    timeZone,
    status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("ARCHIVED")]),
    version,
    createdAt: instant,
    updatedAt: instant,
  },
  { additionalProperties: false },
);

const branchPageSchema = Type.Object(
  {
    items: Type.Array(branchSchema),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

const auditPageSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          id: uuid,
          occurredAt: instant,
          actorPrincipalId: uuid,
          action: Type.String(),
          targetType: Type.String(),
          targetId: uuid,
          details: Type.Record(Type.String(), Type.Unknown()),
        },
        { additionalProperties: false },
      ),
    ),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
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
const scoped = [...session, "RESOURCE_NOT_FOUND", "COMPANY_SUSPENDED"] as const;
const mutation = [
  ...scoped,
  "CSRF_VALIDATION_FAILED",
  "PERMISSION_DENIED",
  "STRONG_AUTHENTICATION_REQUIRED",
  "RESOURCE_VERSION_CONFLICT",
] as const;
const creationKey = Type.Object({
  "idempotency-key": Type.String({
    minLength: 1,
    maxLength: 200,
    pattern: "^[A-Za-z0-9._~-]+$",
  }),
});

export const organizationOperations = [
  {
    method: "GET",
    url: "/companies/:companyId/members",
    operationId: "listCompanyMembers",
    access: "session",
    description:
      "List this company's memberships, including suspended and removed records, by immutable ID. Requires company administration and two-step verification. Presentation names and emails come from the last verified sign-in and never authorize access. Cursors bind the caller, company and collection; access is checked on every page.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        { limit, cursor },
        { additionalProperties: false },
      ),
      response: { 200: memberPageSchema, ...common },
    },
    expectedErrors: [
      ...scoped,
      "PERMISSION_DENIED",
      "STRONG_AUTHENTICATION_REQUIRED",
    ],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/members/:membershipId",
    operationId: "updateCompanyMemberStatus",
    access: "session",
    description:
      "Suspend, reactivate or remove a membership with its observed version. Removal is terminal and affects only this company. Actor authority is rechecked under company-first transaction locks. The responsible administrator and last active administrator are protected. Reactivating an administrator requires the responsible administrator with strong authentication no older than five minutes. An unchanged status is a no-op; a lost response requires reloading the member list before another change.",
    schema: {
      params: memberParams,
      body: Type.Object(
        { expectedVersion: version, status: membershipStatus },
        { additionalProperties: false },
      ),
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [
      ...mutation,
      "MEMBERSHIP_REMOVED",
      "RESPONSIBLE_ADMINISTRATOR_PROTECTED",
      "LAST_ADMINISTRATOR_REQUIRED",
      "RESPONSIBLE_APPROVAL_REQUIRED",
      "RECENT_AUTHENTICATION_REQUIRED",
    ],
  },
  {
    method: "POST",
    url: "/companies",
    operationId: "createCompany",
    access: "session",
    description:
      "Create a company whose creator becomes its responsible administrator. A repeated Idempotency-Key from the same person with the same content returns the same company; different content is rejected. Further administration requires two-step verification.",
    schema: {
      headers: creationKey,
      body: Type.Object(
        { displayName: name, defaultLocale: locale, timeZone },
        { additionalProperties: false },
      ),
      response: {
        201: companyWithAccessSchema,
        200: companyWithAccessSchema,
        ...common,
      },
    },
    expectedErrors: [
      ...session,
      "CSRF_VALIDATION_FAILED",
      "IDEMPOTENCY_KEY_REUSED",
    ],
  },
  {
    method: "GET",
    url: "/companies",
    operationId: "listCompanies",
    access: "session",
    description:
      "List companies with a current active membership, newest first by immutable creation time and ID, with the caller's effective roles. Cursors are bound to the caller and collection; membership is checked again on every page. The default page has 50 entries, with a maximum of 100. Other members' companies are never visible.",
    schema: {
      querystring: Type.Object(
        { limit, cursor },
        { additionalProperties: false },
      ),
      response: { 200: companyListSchema, ...common },
    },
    expectedErrors: [...session],
  },
  {
    method: "GET",
    url: "/companies/:companyId",
    operationId: "getCompany",
    access: "session",
    description:
      "Read a company and the caller's current access. A company the caller does not belong to is reported as not found.",
    schema: {
      params: companyParams,
      response: { 200: companyWithAccessSchema, ...common },
    },
    expectedErrors: [
      ...scoped,
      "PERMISSION_DENIED",
      "STRONG_AUTHENTICATION_REQUIRED",
    ],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId",
    operationId: "updateCompany",
    access: "session",
    description:
      "Change company settings with the observed version. Requires company administration and two-step verification.",
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          expectedVersion: version,
          displayName: Type.Optional(name),
          defaultLocale: Type.Optional(locale),
          timeZone: Type.Optional(timeZone),
        },
        { additionalProperties: false },
      ),
      response: { 200: companySchema, ...common },
    },
    expectedErrors: [...mutation],
  },
  {
    method: "GET",
    url: "/companies/:companyId/branches",
    operationId: "listBranches",
    access: "session",
    description:
      "List the branches the caller may see, active first and by name. Branch-scoped members see only their branches. Cursors are bound to the company and caller.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        { limit, cursor },
        { additionalProperties: false },
      ),
      response: { 200: branchPageSchema, ...common },
    },
    expectedErrors: [
      ...scoped,
      "PERMISSION_DENIED",
      "STRONG_AUTHENTICATION_REQUIRED",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/branches",
    operationId: "createBranch",
    access: "session",
    description:
      "Create a branch; the time zone defaults to the company's. Active branch names are unique within the company regardless of case. A lost response can be reconciled by listing branches. Requires company administration and two-step verification.",
    schema: {
      params: companyParams,
      body: Type.Object(
        { name, timeZone: Type.Optional(timeZone) },
        { additionalProperties: false },
      ),
      response: { 201: branchSchema, ...common },
    },
    expectedErrors: [...mutation, "BRANCH_NAME_IN_USE"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/branches/:branchId",
    operationId: "getBranch",
    access: "session",
    description:
      "Read a branch the caller may see; any other branch is reported as not found.",
    schema: {
      params: branchParams,
      response: { 200: branchSchema, ...common },
    },
    expectedErrors: [...scoped, "STRONG_AUTHENTICATION_REQUIRED"],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/branches/:branchId",
    operationId: "updateBranch",
    access: "session",
    description:
      "Rename a branch or change its time zone with the observed version. Archived branches cannot change. Requires company administration and two-step verification.",
    schema: {
      params: branchParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(name),
          timeZone: Type.Optional(timeZone),
        },
        { additionalProperties: false },
      ),
      response: { 200: branchSchema, ...common },
    },
    expectedErrors: [...mutation, "BRANCH_NAME_IN_USE", "BRANCH_ARCHIVED"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/branches/:branchId/archive",
    operationId: "archiveBranch",
    access: "session",
    description:
      "Archive a branch with the observed version, keeping it for references. Requires company administration and two-step verification.",
    schema: {
      params: branchParams,
      body: Type.Object(
        { expectedVersion: version },
        { additionalProperties: false },
      ),
      response: { 200: branchSchema, ...common },
    },
    expectedErrors: [...mutation, "BRANCH_ARCHIVED"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/audit-events",
    operationId: "listCompanyAuditEvents",
    access: "session",
    description:
      "List the company's organization audit events, newest first. Requires company administration and two-step verification.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        { limit, cursor },
        { additionalProperties: false },
      ),
      response: { 200: auditPageSchema, ...common },
    },
    expectedErrors: [
      ...scoped,
      "PERMISSION_DENIED",
      "STRONG_AUTHENTICATION_REQUIRED",
    ],
  },
] as const;
