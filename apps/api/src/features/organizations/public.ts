// The organizations module's public capability surface. Other modules import
// only this file: they resolve a caller's current company access and decide
// capabilities from it, never by reading organization tables.
import type { Prisma } from "../../generated/prisma/client.js";
import type { HumanContext } from "../identity/public.js";
import type { CompanyAccess } from "./domain.js";
import type { CompanyDescription } from "./prisma-repository.js";

export {
  auditVisibility,
  branchReach,
  decide,
  isTimeZone,
  OrganizationFailure,
  requireCapability,
  type AuditVisibility,
  type Capability,
  type CompanyAccess,
} from "./domain.js";
export { organizationErrors } from "./errors.js";
export type { CompanyDescription } from "./prisma-repository.js";

export type CompanyAccessPort = Readonly<{
  /**
   * Current access of the authenticated human to a company, resolved from
   * PostgreSQL on every call. Throws OrganizationFailure RESOURCE_NOT_FOUND
   * when the caller has no active membership.
   */
  resolve(context: HumanContext, companyId: string): Promise<CompanyAccess>;
  /**
   * For a tenant write in the caller's transaction (tenant data design rule
   * 5): share-locks the company row, rechecks the caller's active membership,
   * rebuilds its access from current grants and share-locks the named
   * branches, returning those that are active. Throws OrganizationFailure
   * RESOURCE_NOT_FOUND without an active membership.
   */
  lockForWrite(
    tx: Prisma.TransactionClient,
    context: HumanContext,
    companyId: string,
    branchIds: readonly string[],
  ): Promise<{ access: CompanyAccess; activeBranchIds: ReadonlySet<string> }>;
  /**
   * As `lockForWrite`, for work a member authorized earlier and the API
   * effects later (an automatic price publication): rechecks that the
   * membership is still active and rebuilds its access from current grants.
   * Null without an active
   * membership; it never resolves a person's current session.
   */
  lockForMembership(
    tx: Prisma.TransactionClient,
    companyId: string,
    membershipId: string,
    branchIds: readonly string[],
  ): Promise<{
    access: CompanyAccess;
    activeBranchIds: ReadonlySet<string>;
  } | null>;
  /**
   * The company's status (null when unknown) and the named branches' name,
   * time zone and status. It authorizes nothing: callers first establish that
   * the human or device may see these branches.
   */
  describe(
    companyId: string,
    branchIds: readonly string[],
  ): Promise<CompanyDescription>;
  /**
   * Registers a check, run in the archiving transaction after the branch row
   * is locked, that answers true while the branch still holds the caller's
   * active resources; archiving then fails with BRANCH_IN_USE.
   */
  guardBranchArchive(
    guard: (
      tx: Prisma.TransactionClient,
      companyId: string,
      branchId: string,
    ) => Promise<boolean>,
  ): void;
}>;
