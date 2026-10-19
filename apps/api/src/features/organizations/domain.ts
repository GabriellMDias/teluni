// Framework-independent organization rules: standard role presets from the
// approved permission matrix (docs/project/identity-and-access.md), scoped
// grants and the tenant access decision (docs/project/tenant-data-design.md).

export type AccessRole =
  "COMPANY_ADMINISTRATOR" | "BRANCH_MANAGER" | "OPERATOR";
export type CompanyStatus = "ACTIVE" | "SUSPENDED";
export type BranchStatus = "ACTIVE" | "ARCHIVED";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";
export type Locale = "pt-BR" | "en-US";

/** Stable business capabilities; persisted grants store roles, not these names. */
export type Capability =
  | "company.view"
  | "company.settings.manage"
  | "branches.view"
  | "branches.manage"
  | "members.manage"
  | "invitations.manage"
  | "audit.view"
  | "devices.view"
  | "devices.manage"
  | "media.view"
  | "media.upload"
  | "media.archive"
  | "media.delete";

type Preset = Readonly<{
  capabilities: ReadonlySet<Capability>;
  /** P12: administrators and branch managers must authenticate strongly. */
  requiresStrongAuthentication: boolean;
}>;

// Only the capabilities implemented so far are listed; the matrix's other
// rows (publication, export) arrive with their modules. Operators pair
// devices and archive media only through an additional grant (an access
// profile); permanent media deletion stays with administrators.
export const rolePresets: Readonly<Record<AccessRole, Preset>> = {
  COMPANY_ADMINISTRATOR: {
    capabilities: new Set([
      "company.view",
      "company.settings.manage",
      "branches.view",
      "branches.manage",
      "members.manage",
      "invitations.manage",
      "audit.view",
      "devices.view",
      "devices.manage",
      "media.view",
      "media.upload",
      "media.archive",
      "media.delete",
    ]),
    requiresStrongAuthentication: true,
  },
  BRANCH_MANAGER: {
    capabilities: new Set([
      "company.view",
      "branches.view",
      "invitations.manage",
      "audit.view",
      "devices.view",
      "devices.manage",
      "media.view",
      "media.upload",
      "media.archive",
    ]),
    requiresStrongAuthentication: true,
  },
  OPERATOR: {
    capabilities: new Set([
      "company.view",
      "branches.view",
      "devices.view",
      "media.view",
      "media.upload",
    ]),
    requiresStrongAuthentication: false,
  },
};

/**
 * Capabilities a company may delegate through a customized access profile.
 * Company settings, branch management and member administration stay with
 * the standard administrator role, so a profile can never bypass the
 * responsible administrator's approval of administrators (P10).
 */
export const delegableCapabilities: readonly Capability[] = [
  "branches.view",
  "invitations.manage",
  "audit.view",
  "devices.view",
  "devices.manage",
  "media.view",
  "media.upload",
  "media.archive",
];

/**
 * Capabilities that need strong authentication whatever role or profile
 * confers them (P12), so a custom label never lowers the assurance a
 * capability requires.
 */
const strongCapabilities: ReadonlySet<Capability> = new Set([
  "company.settings.manage",
  "branches.manage",
  "members.manage",
  "invitations.manage",
  "audit.view",
  "devices.manage",
  "media.archive",
  "media.delete",
]);

/** What a grant confers: a standard role or a company's access profile. */
export type GrantAuthority = Readonly<
  | { role: AccessRole }
  | {
      profileId: string;
      profileName: string;
      capabilities: ReadonlySet<Capability>;
    }
>;

export type Grant = GrantAuthority &
  Readonly<
    { scope: "COMPANY" } | { scope: "BRANCHES"; branchIds: ReadonlySet<string> }
  >;

/** The capabilities a grant confers; every profile includes company.view. */
function capabilitiesOf(grant: GrantAuthority): ReadonlySet<Capability> {
  if ("role" in grant) return rolePresets[grant.role].capabilities;
  return new Set<Capability>(["company.view", ...grant.capabilities]);
}

/**
 * Whether using a capability through a grant needs strong authentication.
 * A standard role sets it for the whole role (P12: administrators and branch
 * managers always); a profile sets it per capability, so a profile's
 * read-only capabilities work in a standard session while its sensitive
 * ones never do.
 */
function needsStrong(grant: GrantAuthority, capability: Capability): boolean {
  return "role" in grant
    ? rolePresets[grant.role].requiresStrongAuthentication
    : strongCapabilities.has(capability);
}

/**
 * Normalizes a profile's capability set: one to all delegable capabilities,
 * without duplicates, in a stable order.
 */
export function profileCapabilities(
  requested: readonly string[],
): Capability[] {
  const unique = new Set(requested);
  if (
    unique.size === 0 ||
    unique.size !== requested.length ||
    ![...unique].every((capability) =>
      (delegableCapabilities as readonly string[]).includes(capability),
    )
  )
    throw new OrganizationFailure("VALIDATION_FAILED");
  return delegableCapabilities.filter((capability) => unique.has(capability));
}

/** Active access profiles a company may keep (an engineering bound). */
export const maxActiveProfiles = 50;

declare const companyAccessBrand: unique symbol;

/**
 * Current, server-resolved access of one principal to one company. Only the
 * organizations module constructs it, from an active membership and its
 * unexpired grants, on every request.
 */
export type CompanyAccess = Readonly<{
  [companyAccessBrand]: true;
  companyId: string;
  companyStatus: CompanyStatus;
  membershipId: string;
  principalId: string;
  responsible: boolean;
  grants: readonly Grant[];
  /** The session is strongly authenticated (teluni-aal2). */
  strong: boolean;
}>;

export function companyAccess(
  value: Omit<CompanyAccess, typeof companyAccessBrand>,
): CompanyAccess {
  return Object.freeze({ ...value }) as CompanyAccess;
}

export type AccessDecision = "allow" | "deny" | "strong_required";

// Basic company information is visible to every member, whatever the scope.
const companyWide: ReadonlySet<Capability> = new Set(["company.view"]);

function covers(
  grant: Grant,
  capability: Capability,
  branchId: string | undefined,
): boolean {
  if (grant.scope === "COMPANY" || companyWide.has(capability)) return true;
  return branchId !== undefined && grant.branchIds.has(branchId);
}

/**
 * Decides one capability, optionally for one branch. Grants combine
 * additively; a grant that needs strong authentication for the capability
 * counts only in a strongly authenticated session. A company-scoped decision (no branch)
 * needs a company-wide grant.
 */
export function decide(
  access: CompanyAccess,
  capability: Capability,
  branchId?: string,
): AccessDecision {
  let strongRequired = false;
  for (const grant of access.grants) {
    if (
      !capabilitiesOf(grant).has(capability) ||
      !covers(grant, capability, branchId)
    )
      continue;
    if (!needsStrong(grant, capability) || access.strong) return "allow";
    strongRequired = true;
  }
  return strongRequired ? "strong_required" : "deny";
}

/**
 * Which branches a capability reaches, for query predicates: every branch,
 * an explicit set, or none. Grants needing strong authentication in a
 * standard session contribute nothing.
 */
export function branchReach(
  access: CompanyAccess,
  capability: Capability,
): "all" | ReadonlySet<string> {
  const reached = new Set<string>();
  for (const grant of access.grants) {
    if (!capabilitiesOf(grant).has(capability)) continue;
    if (needsStrong(grant, capability) && !access.strong) continue;
    if (grant.scope === "COMPANY" || companyWide.has(capability)) return "all";
    for (const id of grant.branchIds) reached.add(id);
  }
  return reached;
}

/** True when some grant would reach the capability once strongly authenticated. */
export function reachableWithStrongAuthentication(
  access: CompanyAccess,
  capability: Capability,
): boolean {
  return access.grants.some(
    (grant) =>
      capabilitiesOf(grant).has(capability) && needsStrong(grant, capability),
  );
}

export type OrganizationFailureCode =
  | "RESOURCE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "COMPANY_SUSPENDED"
  | "STRONG_AUTHENTICATION_REQUIRED"
  | "VALIDATION_FAILED"
  | "RESOURCE_VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "BRANCH_NAME_IN_USE"
  | "BRANCH_ARCHIVED"
  | "PROFILE_NAME_IN_USE"
  | "PROFILE_ARCHIVED"
  | "PROFILE_IN_USE"
  | "PROFILE_LIMIT_REACHED"
  | "BRANCH_IN_USE"
  | "MEMBERSHIP_REMOVED"
  | "RESPONSIBLE_ADMINISTRATOR_PROTECTED"
  | "LAST_ADMINISTRATOR_REQUIRED"
  | "RESPONSIBLE_APPROVAL_REQUIRED"
  | "RECENT_AUTHENTICATION_REQUIRED"
  | "SUCCESSOR_NOT_ELIGIBLE"
  | "RESPONSIBILITY_TRANSFER_PENDING"
  | "RESPONSIBILITY_TRANSFER_NOT_PENDING"
  | "INVITATION_PENDING"
  | "INVITATION_NO_LONGER_VALID"
  | "INVITATION_RECIPIENT_MISMATCH"
  | "MEMBERSHIP_SUSPENDED"
  | "RATE_LIMITED";

export class OrganizationFailure extends Error {
  readonly code: OrganizationFailureCode;
  constructor(code: OrganizationFailureCode) {
    super(`Organization failure: ${code}`);
    this.name = "OrganizationFailure";
    this.code = code;
  }
}

/** Applies a decision, keeping hidden and absent resources indistinguishable. */
export function requireCapability(
  access: CompanyAccess,
  capability: Capability,
  branchId?: string,
): void {
  if (access.companyStatus === "SUSPENDED")
    throw new OrganizationFailure("COMPANY_SUSPENDED");
  const decision = decide(access, capability, branchId);
  if (decision === "strong_required")
    throw new OrganizationFailure("STRONG_AUTHENTICATION_REQUIRED");
  if (decision === "deny") throw new OrganizationFailure("PERMISSION_DENIED");
}

/** IANA zones known to the runtime, including canonical aliases. */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(value) || value.length > 64)
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Trims surrounding whitespace; interior text is the user's own. */
export function normalizeName(value: string): string {
  return value.trim();
}

/** A pending responsibility transfer can be accepted for seven days. */
export const responsibilityTransferDays = 7;

export type GrantScopeName = "COMPANY" | "BRANCHES";

/**
 * Validates a grant scope: a branch scope names one to 100 distinct
 * branches, a company scope none. Returns the branches in a stable order.
 */
export function grantScope(
  scope: GrantScopeName,
  requested: readonly string[] = [],
): string[] {
  const branchIds = [...new Set(requested)].sort();
  if (scope === "COMPANY" && branchIds.length > 0)
    throw new OrganizationFailure("VALIDATION_FAILED");
  if (
    scope === "BRANCHES" &&
    (branchIds.length === 0 ||
      branchIds.length > 100 ||
      branchIds.length !== requested.length)
  )
    throw new OrganizationFailure("VALIDATION_FAILED");
  return branchIds;
}

/**
 * Validates the shape of a requested grant: company administration is
 * always company-wide, and a branch scope names one to 100 distinct branches.
 */
export function grantRequest(input: {
  role: AccessRole;
  scope: GrantScopeName;
  branchIds?: readonly string[];
}): { role: AccessRole; scope: GrantScopeName; branchIds: string[] } {
  if (input.role === "COMPANY_ADMINISTRATOR" && input.scope !== "COMPANY")
    throw new OrganizationFailure("VALIDATION_FAILED");
  const branchIds = grantScope(input.scope, input.branchIds);
  return { role: input.role, scope: input.scope, branchIds };
}

/** A pending invitation can be accepted for seven days (identity policy). */
export const invitationDays = 7;

/**
 * Abuse limits of D-13: invitations created or resent per company in any
 * 24 hours, pending invitations per company, and invitation emails to one
 * address in any 24 hours across all companies.
 */
export const invitationLimits = Object.freeze({
  perCompanyPerDay: 50,
  pendingPerCompany: 100,
  perRecipientPerDay: 3,
});

/** Days a final invitation keeps its address (provisional until PH-13). */
export const invitationAddressRetentionDays = 90;

/**
 * Whether the caller may invite with this grant request now (D-13 "Who may
 * invite"). Administrators invite operators and branch managers anywhere;
 * only the responsible administrator invites administrators, and the
 * repository additionally requires recent strong authentication. Branch
 * managers invite operators to branches they manage, never company-wide.
 */
export function invitationDecision(
  access: CompanyAccess,
  request: {
    role: AccessRole;
    scope: GrantScopeName;
    branchIds: readonly string[];
  },
): AccessDecision | "responsible_required" {
  if (decide(access, "members.manage") === "allow") {
    if (request.role === "COMPANY_ADMINISTRATOR" && !access.responsible)
      return "responsible_required";
    return "allow";
  }
  const reach = branchReach(access, "invitations.manage");
  if (
    request.role === "OPERATOR" &&
    request.scope === "BRANCHES" &&
    request.branchIds.length > 0 &&
    request.branchIds.every((id) => reach === "all" || reach.has(id))
  )
    return "allow";
  if (
    !access.strong &&
    reachableWithStrongAuthentication(access, "invitations.manage")
  )
    return "strong_required";
  return "deny";
}

/** Which invitations a caller may see and manage. */
export type InvitationVisibility =
  { kind: "all" } | { kind: "operators"; branches: "all" | readonly string[] };

/**
 * Administrators see every invitation; branch managers see operator
 * invitations whose branches all lie within the branches they manage.
 * Returns null without any usable invitation capability.
 */
export function invitationVisibility(
  access: CompanyAccess,
): InvitationVisibility | null {
  if (decide(access, "members.manage") === "allow") return { kind: "all" };
  const reach = branchReach(access, "invitations.manage");
  if (reach === "all") return { kind: "operators", branches: "all" };
  if (reach.size > 0) return { kind: "operators", branches: [...reach].sort() };
  return null;
}

/** Which organization audit events a caller may read. */
export type AuditVisibility =
  { kind: "all" } | { kind: "branches"; branches: "all" | readonly string[] };

/**
 * Company administrators read every event. Branch managers read only the
 * operations of their own branches: events that concern at least one branch
 * and only branches they manage, so company-level events and events that
 * also reach other branches stay hidden. Returns null without any usable
 * audit capability.
 */
export function auditVisibility(access: CompanyAccess): AuditVisibility | null {
  if (decide(access, "members.manage") === "allow") return { kind: "all" };
  const reach = branchReach(access, "audit.view");
  if (reach === "all") return { kind: "branches", branches: "all" };
  if (reach.size > 0) return { kind: "branches", branches: [...reach].sort() };
  return null;
}
