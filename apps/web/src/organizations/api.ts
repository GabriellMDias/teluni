import type { paths } from "@teluni/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { ApiFailure, unwrap } from "../api-client.js";
import { identityErrorCodes, sessionApiClient } from "../identity/api.js";
import type { Locale } from "../locale.js";

export const organizationErrorCodes: ReadonlySet<string> = new Set([
  ...identityErrorCodes,
  "PERMISSION_DENIED",
  "COMPANY_SUSPENDED",
  "RESOURCE_VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "BRANCH_NAME_IN_USE",
  "BRANCH_ARCHIVED",
  "MEMBERSHIP_REMOVED",
  "RESPONSIBLE_ADMINISTRATOR_PROTECTED",
  "LAST_ADMINISTRATOR_REQUIRED",
  "RESPONSIBLE_APPROVAL_REQUIRED",
  "SUCCESSOR_NOT_ELIGIBLE",
  "RESPONSIBILITY_TRANSFER_PENDING",
  "RESPONSIBILITY_TRANSFER_NOT_PENDING",
  "INVITATION_PENDING",
  "INVITATION_NO_LONGER_VALID",
  "INVITATION_RECIPIENT_MISMATCH",
  "MEMBERSHIP_SUSPENDED",
  "PROFILE_NAME_IN_USE",
  "PROFILE_ARCHIVED",
  "PROFILE_IN_USE",
  "PROFILE_LIMIT_REACHED",
]);

export type CompanyWithAccess =
  paths["/companies/{companyId}"]["get"]["responses"][200]["content"]["application/json"];
export type CompanySummary =
  paths["/companies"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type Access = CompanyWithAccess["access"];
export type Company = CompanyWithAccess["company"];
export type Capability = Access["capabilities"][number];
export type Role = Access["roles"][number];
export type Branch =
  paths["/companies/{companyId}/branches"]["post"]["responses"][201]["content"]["application/json"];
export type AuditEvent =
  paths["/companies/{companyId}/audit-events"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type Member =
  paths["/companies/{companyId}/members"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type Grant = Member["grants"][number];
export type GrantInput = NonNullable<
  paths["/companies/{companyId}/members/{membershipId}/grants"]["post"]["requestBody"]
>["content"]["application/json"];
export type AccessProfile =
  paths["/companies/{companyId}/access-profiles"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type AccessProfileDetail =
  paths["/companies/{companyId}/access-profiles/{profileId}"]["get"]["responses"][200]["content"]["application/json"];
export type DelegableCapability = AccessProfile["capabilities"][number];
export type Invitation =
  paths["/companies/{companyId}/invitations"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type InvitationInput = NonNullable<
  paths["/companies/{companyId}/invitations"]["post"]["requestBody"]
>["content"]["application/json"];
export type InvitationPreview =
  paths["/invitations/preview"]["post"]["responses"][200]["content"]["application/json"];
export type ResponsibilityTransfer = NonNullable<
  CompanyWithAccess["responsibilityTransfer"]
>;

export const companiesKey = ["organizations", "companies"] as const;
export const companyKey = (id: string) =>
  ["organizations", "company", id] as const;
export const branchesKey = (id: string) =>
  ["organizations", "branches", id] as const;
export const auditKey = (id: string) => ["organizations", "audit", id] as const;
export const membersKey = (id: string) =>
  ["organizations", "members", id] as const;
export const invitationsKey = (id: string) =>
  ["organizations", "invitations", id] as const;
export const profilesKey = (id: string) =>
  ["organizations", "profiles", id] as const;

const client = sessionApiClient;

/** Refreshes everything an access or responsibility change can affect. */
export function invalidateCompany(queries: QueryClient, companyId: string) {
  return Promise.all([
    queries.invalidateQueries({ queryKey: membersKey(companyId) }),
    queries.invalidateQueries({ queryKey: companyKey(companyId) }),
    queries.invalidateQueries({ queryKey: companiesKey }),
    queries.invalidateQueries({ queryKey: auditKey(companyId) }),
    queries.invalidateQueries({ queryKey: invitationsKey(companyId) }),
    queries.invalidateQueries({ queryKey: profilesKey(companyId) }),
  ]);
}

/** Throws the API failure of a write that answers without a body. */
function settle(result: { error?: unknown; response: Response }): void {
  if (!result.response.ok) unwrap(result, organizationErrorCodes);
}

export async function listMembers(companyId: string, cursor?: string) {
  return unwrap(
    await client().GET("/companies/{companyId}/members", {
      params: { path: { companyId }, query: cursor ? { cursor } : {} },
    }),
    organizationErrorCodes,
  );
}

export async function updateMemberStatus(
  companyId: string,
  memberId: string,
  input: { expectedVersion: number; status: Member["status"] },
): Promise<void> {
  const result = await client().PATCH(
    "/companies/{companyId}/members/{membershipId}",
    {
      params: { path: { companyId, membershipId: memberId } },
      body: input,
    },
  );
  settle(result);
}

export async function addMemberGrant(
  companyId: string,
  memberId: string,
  input: GrantInput,
): Promise<Grant> {
  return unwrap(
    await client().POST(
      "/companies/{companyId}/members/{membershipId}/grants",
      {
        params: { path: { companyId, membershipId: memberId } },
        body: input,
      },
    ),
    organizationErrorCodes,
  );
}

export async function revokeMemberGrant(
  companyId: string,
  memberId: string,
  grantId: string,
): Promise<void> {
  settle(
    await client().POST(
      "/companies/{companyId}/members/{membershipId}/grants/{grantId}/revoke",
      { params: { path: { companyId, membershipId: memberId, grantId } } },
    ),
  );
}

export async function listAccessProfiles(
  companyId: string,
  includeArchived = false,
): Promise<AccessProfile[]> {
  return unwrap(
    await client().GET("/companies/{companyId}/access-profiles", {
      params: {
        path: { companyId },
        query: includeArchived ? { includeArchived } : {},
      },
    }),
    organizationErrorCodes,
  ).items;
}

export async function getAccessProfile(
  companyId: string,
  profileId: string,
): Promise<AccessProfileDetail> {
  return unwrap(
    await client().GET("/companies/{companyId}/access-profiles/{profileId}", {
      params: { path: { companyId, profileId } },
    }),
    organizationErrorCodes,
  );
}

export async function createAccessProfile(
  companyId: string,
  input: { name: string; capabilities: DelegableCapability[] },
): Promise<AccessProfile> {
  return unwrap(
    await client().POST("/companies/{companyId}/access-profiles", {
      params: { path: { companyId } },
      body: input,
    }),
    organizationErrorCodes,
  );
}

export async function updateAccessProfile(
  companyId: string,
  profile: Pick<AccessProfile, "id" | "version">,
  changes: { name?: string; capabilities?: DelegableCapability[] },
): Promise<AccessProfile> {
  return unwrap(
    await client().PATCH("/companies/{companyId}/access-profiles/{profileId}", {
      params: { path: { companyId, profileId: profile.id } },
      body: { expectedVersion: profile.version, ...changes },
    }),
    organizationErrorCodes,
  );
}

export async function archiveAccessProfile(
  companyId: string,
  profile: Pick<AccessProfile, "id" | "version">,
): Promise<AccessProfile> {
  return unwrap(
    await client().POST(
      "/companies/{companyId}/access-profiles/{profileId}/archive",
      {
        params: { path: { companyId, profileId: profile.id } },
        body: { expectedVersion: profile.version },
      },
    ),
    organizationErrorCodes,
  );
}

export async function requestResponsibilityTransfer(
  companyId: string,
  successorMembershipId: string,
): Promise<ResponsibilityTransfer> {
  return unwrap(
    await client().POST("/companies/{companyId}/responsibility-transfers", {
      params: { path: { companyId } },
      body: { successorMembershipId },
    }),
    organizationErrorCodes,
  );
}

export async function acceptResponsibilityTransfer(
  companyId: string,
  transferId: string,
): Promise<void> {
  settle(
    await client().POST(
      "/companies/{companyId}/responsibility-transfers/{transferId}/accept",
      { params: { path: { companyId, transferId } } },
    ),
  );
}

/** Cancels the caller's proposal or declines one made to the caller. */
export async function closeResponsibilityTransfer(
  companyId: string,
  transferId: string,
): Promise<void> {
  settle(
    await client().POST(
      "/companies/{companyId}/responsibility-transfers/{transferId}/cancel",
      { params: { path: { companyId, transferId } } },
    ),
  );
}

export async function createInvitation(
  companyId: string,
  input: InvitationInput,
): Promise<Invitation> {
  return unwrap(
    await client().POST("/companies/{companyId}/invitations", {
      params: { path: { companyId } },
      body: input,
    }),
    organizationErrorCodes,
  );
}

export async function listInvitations(companyId: string, cursor?: string) {
  return unwrap(
    await client().GET("/companies/{companyId}/invitations", {
      params: { path: { companyId }, query: cursor ? { cursor } : {} },
    }),
    organizationErrorCodes,
  );
}

export async function resendInvitation(
  companyId: string,
  invitationId: string,
): Promise<Invitation> {
  return unwrap(
    await client().POST(
      "/companies/{companyId}/invitations/{invitationId}/resend",
      { params: { path: { companyId, invitationId } } },
    ),
    organizationErrorCodes,
  );
}

export async function revokeInvitation(
  companyId: string,
  invitationId: string,
): Promise<void> {
  settle(
    await client().POST(
      "/companies/{companyId}/invitations/{invitationId}/revoke",
      { params: { path: { companyId, invitationId } } },
    ),
  );
}

/** The credential travels only in request bodies, never in a URL. */
export async function previewInvitation(
  credential: string,
): Promise<InvitationPreview> {
  return unwrap(
    await client().POST("/invitations/preview", { body: { credential } }),
    organizationErrorCodes,
  );
}

export async function acceptInvitation(
  credential: string,
): Promise<{ companyId: string; membershipId: string }> {
  return unwrap(
    await client().POST("/invitations/accept", { body: { credential } }),
    organizationErrorCodes,
  );
}

export async function listCompanies(cursor?: string) {
  return unwrap(
    await client().GET("/companies", {
      params: { query: cursor ? { cursor } : {} },
    }),
    organizationErrorCodes,
  );
}

export async function createCompany(
  input: { displayName: string; defaultLocale: Locale; timeZone: string },
  idempotencyKey: string,
): Promise<{ company: Company; access: Access }> {
  return unwrap(
    await client().POST("/companies", {
      params: { header: { "idempotency-key": idempotencyKey } },
      body: input,
    }),
    organizationErrorCodes,
  );
}

export async function getCompany(
  companyId: string,
): Promise<CompanyWithAccess> {
  return unwrap(
    await client().GET("/companies/{companyId}", {
      params: { path: { companyId } },
    }),
    organizationErrorCodes,
  );
}

export async function updateCompany(
  companyId: string,
  input: Pick<Company, "displayName" | "defaultLocale" | "timeZone"> & {
    expectedVersion: number;
  },
): Promise<Company> {
  return unwrap(
    await client().PATCH("/companies/{companyId}", {
      params: { path: { companyId } },
      body: input,
    }),
    organizationErrorCodes,
  );
}

export async function listAuditEvents(companyId: string, cursor?: string) {
  return unwrap(
    await client().GET("/companies/{companyId}/audit-events", {
      params: { path: { companyId }, query: cursor ? { cursor } : {} },
    }),
    organizationErrorCodes,
  );
}

export async function listBranches(
  companyId: string,
  cursor?: string,
): Promise<{ items: Branch[]; nextCursor: string | null }> {
  return unwrap(
    await client().GET("/companies/{companyId}/branches", {
      params: { path: { companyId }, query: cursor ? { cursor } : {} },
    }),
    organizationErrorCodes,
  );
}

/** Active branches a grant can name; the API caps one page at 100. */
export async function listBranchChoices(
  companyId: string,
): Promise<{ items: Branch[]; truncated: boolean }> {
  const page = unwrap(
    await client().GET("/companies/{companyId}/branches", {
      params: { path: { companyId }, query: { limit: 100 } },
    }),
    organizationErrorCodes,
  );
  return {
    items: page.items.filter((branch) => branch.status === "ACTIVE"),
    truncated: page.nextCursor !== null,
  };
}

export async function createBranch(
  companyId: string,
  name: string,
): Promise<Branch> {
  return unwrap(
    await client().POST("/companies/{companyId}/branches", {
      params: { path: { companyId } },
      body: { name },
    }),
    organizationErrorCodes,
  );
}

export async function renameBranch(
  companyId: string,
  branch: Branch,
  name: string,
): Promise<Branch> {
  return unwrap(
    await client().PATCH("/companies/{companyId}/branches/{branchId}", {
      params: { path: { companyId, branchId: branch.id } },
      body: { expectedVersion: branch.version, name },
    }),
    organizationErrorCodes,
  );
}

export async function archiveBranch(
  companyId: string,
  branch: Branch,
): Promise<Branch> {
  return unwrap(
    await client().POST("/companies/{companyId}/branches/{branchId}/archive", {
      params: { path: { companyId, branchId: branch.id } },
      body: { expectedVersion: branch.version },
    }),
    organizationErrorCodes,
  );
}

/** Localized failure text; a failed or lost write is an unknown outcome. */
export function describe(
  error: unknown,
  t: {
    errors: Record<string, string>;
    network: string;
    unknownWrite: string;
    generic: string;
  },
  operation: "read" | "write",
): string {
  if (!(error instanceof ApiFailure))
    return operation === "write" ? t.unknownWrite : t.network;
  if (
    error.status >= 500 &&
    operation === "write" &&
    error.code !== "SERVICE_UNAVAILABLE"
  )
    return t.unknownWrite;
  return t.errors[error.code] ?? t.generic;
}
