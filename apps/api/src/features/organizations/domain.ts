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
      "audit.view",
    ]),
    requiresStrongAuthentication: true,
  },
  BRANCH_MANAGER: {
    capabilities: new Set(["company.view", "branches.view"]),
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
  | "RECENT_AUTHENTICATION_REQUIRED";

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
