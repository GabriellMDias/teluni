import type { ApiModule } from "../../module.js";
import type { HumanProfilePort, HumanSessionPort } from "../identity/public.js";
import { organizationOperations } from "./contracts.js";
import { organizationErrors } from "./errors.js";
import {
  PrismaOrganizationRepository,
  type BranchArchiveGuard,
} from "./prisma-repository.js";
import type { CompanyAccessPort } from "./public.js";
import { registerOrganizationRoutes } from "./routes.js";
import { OrganizationService } from "./service.js";

/**
 * Composes the organizations module over the identity session boundary and
 * exposes the company-access port to downstream modules.
 */
export function createOrganizationsModule(options: {
  sessions: HumanSessionPort;
  profiles: HumanProfilePort;
  rateLimit?: { max: number; timeWindow: number };
}): { module: ApiModule; companies: CompanyAccessPort } {
  let service: OrganizationService | undefined;
  let repository: PrismaOrganizationRepository | undefined;
  const guards: BranchArchiveGuard[] = [];
  const companies: CompanyAccessPort = {
    resolve(context, companyId) {
      if (!service) throw new Error("The organizations module is not active");
      return service.access(context, companyId);
    },
    lockForWrite(tx, context, companyId, branchIds) {
      if (!repository)
        throw new Error("The organizations module is not active");
      return repository.lockForWrite(
        tx,
        context.principalId,
        context.strongAuthenticationAgeSeconds !== null,
        companyId,
        branchIds,
      );
    },
    describe(companyId, branchIds) {
      if (!repository)
        throw new Error("The organizations module is not active");
      return repository.describe(companyId, branchIds);
    },
    guardBranchArchive(guard) {
      guards.push(guard);
      repository?.addBranchArchiveGuard(guard);
    },
  };
  const module: ApiModule = {
    name: "organizations",
    tag: "Organizations",
    requires: ["database"],
    requiresModules: ["identity"],
    operations: organizationOperations,
    errors: organizationErrors,
    activate: ({ database }) => {
      // Activation guarantees the database and the identity module.
      repository = new PrismaOrganizationRepository(database!);
      for (const guard of guards) repository.addBranchArchiveGuard(guard);
      const active = new OrganizationService(repository, options.profiles);
      service = active;
      return {
        name: "organizations",
        register: (app) =>
          registerOrganizationRoutes(
            app,
            active,
            options.sessions,
            options.rateLimit,
          ),
      };
    },
  };
  return { module, companies };
}
