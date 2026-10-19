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
  Type.Literal("invitations.manage"),
  Type.Literal("audit.view"),
  Type.Literal("devices.view"),
  Type.Literal("devices.manage"),
  Type.Literal("media.view"),
  Type.Literal("media.upload"),
  Type.Literal("media.archive"),
  Type.Literal("media.delete"),
]);
const delegableCapability = Type.Union([
  Type.Literal("branches.view"),
  Type.Literal("invitations.manage"),
  Type.Literal("audit.view"),
  Type.Literal("devices.view"),
  Type.Literal("devices.manage"),
  Type.Literal("media.view"),
  Type.Literal("media.upload"),
  Type.Literal("media.archive"),
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
const grantScope = Type.Union([
  Type.Literal("COMPANY"),
  Type.Literal("BRANCHES"),
]);
export const grantSchema = Type.Object(
  {
    id: uuid,
    /** The standard role, or null when the grant carries an access profile. */
    role: Type.Union([role, Type.Null()]),
    profile: Type.Union([
      Type.Object({ id: uuid, name }, { additionalProperties: false }),
      Type.Null(),
    ]),
    scope: grantScope,
    branches: Type.Array(
      Type.Object({ id: uuid, name }, { additionalProperties: false }),
    ),
    startsAt: instant,
    expiresAt: Type.Union([instant, Type.Null()]),
  },
  { additionalProperties: false },
);
const profileStatus = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("ARCHIVED"),
]);
export const profileSchema = Type.Object(
  {
    id: uuid,
    name,
    capabilities: Type.Array(delegableCapability),
    status: profileStatus,
    version,
    createdAt: instant,
    updatedAt: instant,
    memberCount: Type.Integer({ minimum: 0 }),
    grantCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
const profileDetailSchema = Type.Object(
  {
    profile: profileSchema,
    holders: Type.Array(
      Type.Object(
        {
          grantId: uuid,
          membershipId: uuid,
          membershipStatus: membershipStatus,
          displayName: Type.Union([Type.String(), Type.Null()]),
          email: Type.Union([Type.String(), Type.Null()]),
          scope: grantScope,
          branches: Type.Array(
            Type.Object({ id: uuid, name }, { additionalProperties: false }),
          ),
          expiresAt: Type.Union([instant, Type.Null()]),
        },
        { additionalProperties: false },
      ),
    ),
    holdersTruncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
const profileCapabilities = Type.Array(delegableCapability, {
  minItems: 1,
  maxItems: 5,
  uniqueItems: true,
});
export const transferSchema = Type.Object(
  {
    id: uuid,
    direction: Type.Union([Type.Literal("outgoing"), Type.Literal("incoming")]),
    fromMembershipId: uuid,
    toMembershipId: uuid,
    counterpartName: Type.Union([Type.String(), Type.Null()]),
    counterpartEmail: Type.Union([Type.String(), Type.Null()]),
    createdAt: instant,
    expiresAt: instant,
  },
  { additionalProperties: false },
);
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
          grants: Type.Array(grantSchema),
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
    /** Names of the customized access profiles the caller holds. */
    profiles: Type.Array(name),
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
  {
    company: companySchema,
    access: accessSchema,
    /** The caller's pending responsibility transfer, as proposer or successor. */
    responsibilityTransfer: Type.Union([transferSchema, Type.Null()]),
  },
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

const profileParams = Type.Object(
  { companyId: uuid, profileId: uuid },
  { additionalProperties: false },
);
const grantParams = Type.Object(
  { companyId: uuid, membershipId: uuid, grantId: uuid },
  { additionalProperties: false },
);
const transferParams = Type.Object(
  { companyId: uuid, transferId: uuid },
  { additionalProperties: false },
);

export const organizationOperations = [
  {
    method: "POST",
    url: "/companies/:companyId/members/:membershipId/grants",
    operationId: "addMemberGrant",
    access: "session",
    description:
      "Grant a standard role or one of the company's active access profiles (exactly one of role and profileId) to a membership, over the whole company or explicit active branches, optionally until an expiry instant (no automatic renewal). Requires company administration and two-step verification. Only the responsible administrator, with strong authentication no older than five minutes, may grant company administration, which is always company-wide. Unknown, archived and other companies' branches and profiles are rejected alike. An identical effective grant is returned with 200 instead of duplicated.",
    schema: {
      params: memberParams,
      body: Type.Object(
        {
          role: Type.Optional(role),
          profileId: Type.Optional(uuid),
          scope: grantScope,
          branchIds: Type.Optional(
            Type.Array(uuid, { minItems: 1, maxItems: 100 }),
          ),
          expiresAt: Type.Optional(instant),
        },
        { additionalProperties: false },
      ),
      response: { 201: grantSchema, 200: grantSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "MEMBERSHIP_REMOVED",
      "RESPONSIBLE_APPROVAL_REQUIRED",
      "RECENT_AUTHENTICATION_REQUIRED",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/members/:membershipId/grants/:grantId/revoke",
    operationId: "revokeMemberGrant",
    access: "session",
    description:
      "Revoke one of a membership's grants; revocation is terminal and an already revoked or expired grant is a no-op. Requires company administration and two-step verification. The responsible administrator and the last active administrator keep company administration.",
    schema: {
      params: grantParams,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [
      ...mutation,
      "RESPONSIBLE_ADMINISTRATOR_PROTECTED",
      "LAST_ADMINISTRATOR_REQUIRED",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/responsibility-transfers",
    operationId: "requestResponsibilityTransfer",
    access: "session",
    description:
      "Propose handing company responsibility to another active company administrator, who must accept it within seven days. Only the responsible administrator, with strong authentication no older than five minutes, may propose; one proposal per company can be pending. Responsibility does not move until the successor accepts.",
    schema: {
      params: companyParams,
      body: Type.Object(
        { successorMembershipId: uuid },
        { additionalProperties: false },
      ),
      response: { 201: transferSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "RESPONSIBLE_APPROVAL_REQUIRED",
      "RECENT_AUTHENTICATION_REQUIRED",
      "SUCCESSOR_NOT_ELIGIBLE",
      "RESPONSIBILITY_TRANSFER_PENDING",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/responsibility-transfers/:transferId/accept",
    operationId: "acceptResponsibilityTransfer",
    access: "session",
    description:
      "The proposed successor accepts responsibility. They must still be an active company administrator with strong authentication no older than five minutes, and the proposer must still be responsible. Other members learn nothing about the transfer.",
    schema: {
      params: transferParams,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [
      ...mutation,
      "RECENT_AUTHENTICATION_REQUIRED",
      "SUCCESSOR_NOT_ELIGIBLE",
      "RESPONSIBILITY_TRANSFER_NOT_PENDING",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/responsibility-transfers/:transferId/cancel",
    operationId: "closeResponsibilityTransfer",
    access: "session",
    description:
      "The proposer cancels, or the successor declines, a pending responsibility transfer. Responsibility does not change.",
    schema: {
      params: transferParams,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...mutation, "RESPONSIBILITY_TRANSFER_NOT_PENDING"],
  },
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
      "Archive a branch with the observed version, keeping it for references. A branch with active resources, such as paired screens, answers BRANCH_IN_USE. Requires company administration and two-step verification.",
    schema: {
      params: branchParams,
      body: Type.Object(
        { expectedVersion: version },
        { additionalProperties: false },
      ),
      response: { 200: branchSchema, ...common },
    },
    expectedErrors: [...mutation, "BRANCH_ARCHIVED", "BRANCH_IN_USE"],
  },
  {
    method: "GET",
    url: "/companies/:companyId/audit-events",
    operationId: "listCompanyAuditEvents",
    access: "session",
    description:
      "List the company's organization audit events, newest first. Company administrators read every event; branch managers read only events that concern their own branches and no other branch. Requires two-step verification.",
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
  {
    method: "GET",
    url: "/companies/:companyId/access-profiles",
    operationId: "listAccessProfiles",
    access: "session",
    description:
      "List the company's customized access profiles with how many members and effective grants hold each, active first by name. Archived profiles are included only on request. Requires company administration and two-step verification.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        { includeArchived: Type.Optional(Type.Boolean()) },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          { items: Type.Array(profileSchema) },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [
      ...scoped,
      "PERMISSION_DENIED",
      "STRONG_AUTHENTICATION_REQUIRED",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/access-profiles",
    operationId: "createAccessProfile",
    access: "session",
    description:
      "Create a customized access profile from delegable capabilities (branches.view, invitations.manage, audit.view, devices.view, devices.manage, media.view, media.upload, media.archive); company administration is never delegable through a profile. A profile containing a capability that needs two-step verification requires it of every holder. Active names are unique per company and a company keeps at most 50 active profiles. Requires company administration and two-step verification.",
    schema: {
      params: companyParams,
      body: Type.Object(
        { name, capabilities: profileCapabilities },
        { additionalProperties: false },
      ),
      response: { 201: profileSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "PROFILE_NAME_IN_USE",
      "PROFILE_LIMIT_REACHED",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/access-profiles/:profileId",
    operationId: "getAccessProfile",
    access: "session",
    description:
      "Read an access profile with its current holders (members, scopes and branches of its effective grants, up to 500), so the reach of an edit is visible before it is made. Requires company administration and two-step verification.",
    schema: {
      params: profileParams,
      response: { 200: profileDetailSchema, ...common },
    },
    expectedErrors: [
      ...scoped,
      "PERMISSION_DENIED",
      "STRONG_AUTHENTICATION_REQUIRED",
    ],
  },
  {
    method: "PATCH",
    url: "/companies/:companyId/access-profiles/:profileId",
    operationId: "updateAccessProfile",
    access: "session",
    description:
      "Rename an active access profile or replace its capabilities with the observed version. Every holder's access follows the change on its next request, and the audit event records the added and removed capabilities and the affected grants. An unchanged request is a no-op. Requires company administration and two-step verification.",
    schema: {
      params: profileParams,
      body: Type.Object(
        {
          expectedVersion: version,
          name: Type.Optional(name),
          capabilities: Type.Optional(profileCapabilities),
        },
        { additionalProperties: false },
      ),
      response: { 200: profileSchema, ...common },
    },
    expectedErrors: [...mutation, "PROFILE_NAME_IN_USE", "PROFILE_ARCHIVED"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/access-profiles/:profileId/archive",
    operationId: "archiveAccessProfile",
    access: "session",
    description:
      "Archive an access profile with the observed version once no effective grant holds it; archived profiles stay for attribution and cannot be granted or edited. Requires company administration and two-step verification.",
    schema: {
      params: profileParams,
      body: Type.Object(
        { expectedVersion: version },
        { additionalProperties: false },
      ),
      response: { 200: profileSchema, ...common },
    },
    expectedErrors: [...mutation, "PROFILE_IN_USE", "PROFILE_ARCHIVED"],
  },
] as const;

// Shared wire fragments for the invitations operations of this feature.
export {
  common,
  companyParams,
  cursor,
  grantScope,
  instant,
  limit,
  mutation,
  name,
  role,
  scoped,
  session,
  uuid,
};
