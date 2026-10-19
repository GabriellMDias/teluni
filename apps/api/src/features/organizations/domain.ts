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
  | "audit.view";

type Preset = Readonly<{
  capabilities: ReadonlySet<Capability>;
  /** P12: administrators and branch managers must authenticate strongly. */
  requiresStrongAuthentication: boolean;
}>;

// Only the capabilities implemented so far are listed; the matrix's other
// rows (content, devices, publication, export) arrive with their modules.
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
    ]),
    requiresStrongAuthentication: true,
  },
  BRANCH_MANAGER: {
    capabilities: new Set([
      "company.view",
      "branches.view",
      "invitations.manage",
    ]),
    requiresStrongAuthentication: true,
  },
  OPERATOR: {
    capabilities: new Set(["company.view", "branches.view"]),
    requiresStrongAuthentication: false,
  },
};

export type Grant = Readonly<
  | { role: AccessRole; scope: "COMPANY" }
  | { role: AccessRole; scope: "BRANCHES"; branchIds: ReadonlySet<string> }
>;

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
 * additively; a grant whose role requires strong authentication counts only
 * in a strongly authenticated session. A company-scoped decision (no branch)
 * needs a company-wide grant.
 */
export function decide(
  access: CompanyAccess,
  capability: Capability,
  branchId?: string,
): AccessDecision {
  let needsStrong = false;
  for (const grant of access.grants) {
    const preset = rolePresets[grant.role];
    if (
      !preset.capabilities.has(capability) ||
      !covers(grant, capability, branchId)
    )
      continue;
    if (!preset.requiresStrongAuthentication || access.strong) return "allow";
    needsStrong = true;
  }
  return needsStrong ? "strong_required" : "deny";
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
    const preset = rolePresets[grant.role];
    if (!preset.capabilities.has(capability)) continue;
    if (preset.requiresStrongAuthentication && !access.strong) continue;
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
      rolePresets[grant.role].capabilities.has(capability) &&
      rolePresets[grant.role].requiresStrongAuthentication,
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
 * Validates the shape of a requested grant: company administration is
 * always company-wide, and a branch scope names one to 100 distinct branches.
 */
export function grantRequest(input: {
  role: AccessRole;
  scope: GrantScopeName;
  branchIds?: readonly string[];
}): { role: AccessRole; scope: GrantScopeName; branchIds: string[] } {
  const branchIds = [...new Set(input.branchIds ?? [])].sort();
  if (input.role === "COMPANY_ADMINISTRATOR" && input.scope !== "COMPANY")
    throw new OrganizationFailure("VALIDATION_FAILED");
  if (input.scope === "COMPANY" && branchIds.length > 0)
    throw new OrganizationFailure("VALIDATION_FAILED");
  if (
    input.scope === "BRANCHES" &&
    (branchIds.length === 0 ||
      branchIds.length > 100 ||
      branchIds.length !== (input.branchIds ?? []).length)
  )
    throw new OrganizationFailure("VALIDATION_FAILED");
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
