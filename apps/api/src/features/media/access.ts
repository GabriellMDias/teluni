import {
  branchReach,
  decide,
  OrganizationFailure,
  requireCapability,
  type Capability,
  type CompanyAccess,
} from "../organizations/public.js";
import { MediaFailure } from "./domain.js";
import type { MediaRecord } from "./prisma-repository.js";

/**
 * Whether the access may see an item: company items through any media
 * grant in the company, branch items through a grant on their branch, and
 * items in the trash only with company-wide deletion authority.
 */
export function visible(access: CompanyAccess, item: MediaRecord): boolean {
  if (item.status === "PURGED") return false;
  if (item.status === "DELETED")
    return decide(access, "media.delete") === "allow";
  return scopeVisible(access, item.branchId);
}

/** Hidden items answer RESOURCE_NOT_FOUND; visible ones explain denials. */
export function requireOn(
  access: CompanyAccess,
  capability: Capability,
  item: MediaRecord,
): void {
  if (access.companyStatus === "SUSPENDED")
    throw new OrganizationFailure("COMPANY_SUSPENDED");
  if (!visible(access, item)) throw new MediaFailure("RESOURCE_NOT_FOUND");
  requireCapability(access, capability, item.branchId ?? undefined);
}

/** Company-owned metadata is shared; branch-owned metadata stays branch-scoped. */
export function scopeVisible(
  access: CompanyAccess,
  branchId: string | null,
): boolean {
  if (branchId === null) {
    const reach = branchReach(access, "media.view");
    return reach === "all" || reach.size > 0;
  }
  return decide(access, "media.view", branchId) === "allow";
}
