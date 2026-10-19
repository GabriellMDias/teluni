import type { ApiModule } from "../../module.js";
import type { DevicePort } from "../devices/public.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { MediaPort } from "../media/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import { programmingOperations } from "./contracts.js";
import { programmingErrors } from "./errors.js";
import { PrismaProgrammingRepository } from "./prisma-repository.js";
import {
  registerProgrammingRoutes,
  type ProgrammingRouteLimits,
} from "./routes.js";
import { ProgrammingService } from "./service.js";

/**
 * Composes playlists, programming groups, programs and timelines (the
 * programming design, ADR-0029) over the organizations, devices and media
 * ports. Playlists protect their media from deletion, group spans protect
 * their branches from archiving, and a screen moved outside its group's span
 * leaves the group in the move's transaction.
 */
export function createProgrammingModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  devices: DevicePort;
  media: MediaPort;
  limits?: ProgrammingRouteLimits;
}): ApiModule {
  let service: ProgrammingService | undefined;
  options.media.registerReferenceGuard("playlist-draft", (tx, companyId, id) =>
    service ? service.mediaReferences(tx, companyId, id) : Promise.resolve([]),
  );
  options.companies.guardBranchArchive((tx, companyId, branchId) =>
    service
      ? service.branchInUse(tx, companyId, branchId)
      : Promise.resolve(false),
  );
  options.devices.onMove(async (tx, move) => {
    if (service) await service.onDeviceMoved(tx, move);
  });
  return {
    name: "programming",
    tag: "Programming",
    requires: ["database"],
    requiresModules: ["identity", "organizations", "devices", "media"],
    operations: programmingOperations,
    errors: programmingErrors,
    activate: ({ database }) => {
      // Activation guarantees the database and the required modules.
      const active = new ProgrammingService({
        repository: new PrismaProgrammingRepository(database!),
        companies: options.companies,
        devices: options.devices,
        media: options.media,
      });
      service = active;
      return {
        name: "programming",
        register: (app) =>
          registerProgrammingRoutes(
            app,
            active,
            options.sessions,
            options.limits,
          ),
      };
    },
  };
}
