import type { ApiModule } from "../../module.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import { deviceOperations } from "./contracts.js";
import { deviceErrors } from "./errors.js";
import { PrismaDeviceRepository } from "./prisma-repository.js";
import { registerDeviceRoutes, type DeviceRouteLimits } from "./routes.js";
import { DeviceService } from "./service.js";

/**
 * Composes screen enrollment and lifecycle (ADR-0027) over the identity
 * session boundary and the organizations access port. Archiving a branch
 * that still holds active screens is refused through the port's guard.
 */
export function createDevicesModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  limits?: DeviceRouteLimits;
}): ApiModule {
  let service: DeviceService | undefined;
  options.companies.guardBranchArchive((tx, companyId, branchId) =>
    service
      ? service.branchInUse(tx, companyId, branchId)
      : Promise.resolve(false),
  );
  return {
    name: "devices",
    tag: "Devices",
    requires: ["database", "deviceEnrollment"],
    requiresModules: ["identity", "organizations"],
    operations: deviceOperations,
    errors: deviceErrors,
    activate: ({ database, deviceEnrollment }) => {
      // Activation guarantees the database, code keys and modules.
      const active = new DeviceService({
        repository: new PrismaDeviceRepository(database!),
        companies: options.companies,
        codeKeys: deviceEnrollment!.codeKeys,
      });
      service = active;
      return {
        name: "devices",
        register: (app) =>
          registerDeviceRoutes(app, active, options.sessions, options.limits),
      };
    },
  };
}
