import type { ApiModule } from "../../module.js";
import type { HumanSessionPort } from "../identity/public.js";
import { organizationOperations } from "./contracts.js";
import { organizationErrors } from "./errors.js";
import { PrismaOrganizationRepository } from "./prisma-repository.js";
import type { CompanyAccessPort } from "./public.js";
import { registerOrganizationRoutes } from "./routes.js";
import { OrganizationService } from "./service.js";

/**
 * Composes the organizations module over the identity session boundary and
 * exposes the company-access port to downstream modules.
 */
export function createOrganizationsModule(options: {
  sessions: HumanSessionPort;
  rateLimit?: { max: number; timeWindow: number };
}): { module: ApiModule; companies: CompanyAccessPort } {
  let service: OrganizationService | undefined;
  const companies: CompanyAccessPort = {
    resolve(context, companyId) {
      if (!service) throw new Error("The organizations module is not active");
      return service.access(context, companyId);
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
      const active = new OrganizationService(
        new PrismaOrganizationRepository(database!),
      );
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
