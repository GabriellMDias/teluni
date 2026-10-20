import type { ApiModule } from "../../module.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import { deviceOperations } from "./contracts.js";
import { deviceErrors } from "./errors.js";
import { PrismaDeviceRepository } from "./prisma-repository.js";
import type { DeviceMoveHook, DevicePort } from "./public.js";
import { registerDeviceRoutes, type DeviceRouteLimits } from "./routes.js";
import { DeviceService } from "./service.js";

/**
 * Composes screen enrollment and lifecycle (ADR-0027) over the identity
 * session boundary and the organizations access port. Archiving a branch
 * that still holds active screens is refused through the port's guard.
 * Modules that configure screens use the returned port.
 */
export function createDevicesModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  limits?: DeviceRouteLimits;
}): { module: ApiModule; devices: DevicePort } {
  let service: DeviceService | undefined;
  const moveHooks: DeviceMoveHook[] = [];
  options.companies.guardBranchArchive((tx, companyId, branchId) =>
    service
      ? service.branchInUse(tx, companyId, branchId)
      : Promise.resolve(false),
  );
  const devices: DevicePort = {
    onMove(hook) {
      moveHooks.push(hook);
      service?.addMoveHook(hook);
    },
    async describe(tx, companyId, deviceIds) {
      if (!service) throw new Error("The devices module is not active");
      const rows = await service.describe(tx, companyId, deviceIds);
      return rows.map((row) => ({
        id: row.id,
        branchId: row.branchId,
        name: row.name,
        status: row.status,
        timeZone: row.timeZone,
      }));
    },
    async authenticate(authorization) {
      if (!service) throw new Error("The devices module is not active");
      const { identity } = await service.authenticate(authorization);
      const self = await service.self(identity);
      return {
        deviceId: identity.id,
        companyId: identity.companyId,
        branchId: identity.branchId,
        status: self.status,
        timeZone: self.timeZone,
        rotation: self.rotation,
        authorizedUntil: self.authorizedUntil,
        serverTime: self.serverTime,
      };
    },
  };
  const module: ApiModule = {
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
      for (const hook of moveHooks) active.addMoveHook(hook);
      service = active;
      return {
        name: "devices",
        register: (app) =>
          registerDeviceRoutes(app, active, options.sessions, options.limits),
      };
    },
  };
  return { module, devices };
}
