// The organizations module's public capability surface. Other modules import
// only this file: they resolve a caller's current company access and decide
// capabilities from it, never by reading organization tables.
import type { HumanContext } from "../identity/public.js";
import type { CompanyAccess } from "./domain.js";

export {
  branchReach,
  decide,
  OrganizationFailure,
  requireCapability,
  type Capability,
  type CompanyAccess,
} from "./domain.js";
export { organizationErrors } from "./errors.js";

export type CompanyAccessPort = Readonly<{
  /**
   * Current access of the authenticated human to a company, resolved from
   * PostgreSQL on every call. Throws OrganizationFailure RESOURCE_NOT_FOUND
   * when the caller has no active membership.
   */
  resolve(context: HumanContext, companyId: string): Promise<CompanyAccess>;
}>;
