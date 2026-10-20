import type { ApiModule } from "../../module.js";
import type { CatalogPort } from "../catalogs/public.js";
import type { DevicePort } from "../devices/public.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { MediaPort } from "../media/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import { programmingOperations } from "./contracts.js";
import { programmingErrors } from "./errors.js";
import { layoutOperations } from "./layouts-contracts.js";
import { PrismaLayoutRepository } from "./layouts-repository.js";
import { registerLayoutRoutes } from "./layouts-routes.js";
import { LayoutService } from "./layouts-service.js";
import { PrismaProgrammingRepository } from "./prisma-repository.js";
import type { ProgrammingPort, PublicationFacts } from "./public.js";
import {
  registerProgrammingRoutes,
  type ProgrammingRouteLimits,
} from "./routes.js";
import { ProgrammingService } from "./service.js";

/**
 * Composes playlists, layouts, programming groups, programs and timelines
 * (the programming design, ADR-0029, and the catalog and composition
 * design) over the organizations, devices, media and catalogs ports.
 * Playlists and layout pages protect their media from deletion, layouts
 * protect the catalogs and fields they bind, group spans protect their
 * branches from archiving, and a screen moved outside its group's span
 * leaves the group in the move's transaction. Publications use the
 * returned port to snapshot programs and register publication facts.
 */
export function createProgrammingModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  devices: DevicePort;
  media: MediaPort;
  catalogs: CatalogPort;
  limits?: ProgrammingRouteLimits;
}): { module: ApiModule; programming: ProgrammingPort } {
  let service: ProgrammingService | undefined;
  let layouts: LayoutService | undefined;
  let publicationFacts: PublicationFacts | undefined;
  const require = () => {
    if (!service) throw new Error("The programming module is not active");
    return service;
  };
  const programming: ProgrammingPort = {
    onPublicationFacts(facts) {
      publicationFacts = facts;
      service?.onPublicationFacts(facts);
    },
    target: (tx, access, source, capability) =>
      require().publicationTarget(tx, access, source, capability),
    snapshot: (tx, access, source, capability) =>
      require().publicationSnapshot(tx, access, source, capability),
    currentProgram: (companyId, deviceId) =>
      require().currentProgram(companyId, deviceId),
    followers: (companyId, source) => require().followers(companyId, source),
  };
  options.media.registerReferenceGuard("playlist-draft", (tx, companyId, id) =>
    service ? service.mediaReferences(tx, companyId, id) : Promise.resolve([]),
  );
  options.media.registerReferenceGuard("layout-draft", (tx, companyId, id) =>
    layouts ? layouts.mediaReferences(tx, companyId, id) : Promise.resolve([]),
  );
  options.catalogs.registerUsageGuard((tx, companyId, catalogId) =>
    layouts
      ? layouts.catalogUsage(tx, companyId, catalogId)
      : Promise.resolve({ layouts: 0, fields: new Map<string, number>() }),
  );
  options.companies.guardBranchArchive((tx, companyId, branchId) =>
    service
      ? service.branchInUse(tx, companyId, branchId)
      : Promise.resolve(false),
  );
  options.devices.onMove(async (tx, move) => {
    if (service) await service.onDeviceMoved(tx, move);
  });
  const module: ApiModule = {
    name: "programming",
    tag: "Programming",
    requires: ["database"],
    requiresModules: [
      "identity",
      "organizations",
      "devices",
      "media",
      "catalogs",
    ],
    operations: [...programmingOperations, ...layoutOperations],
    errors: programmingErrors,
    activate: ({ database }) => {
      // Activation guarantees the database and the required modules.
      const layoutRepository = new PrismaLayoutRepository(database!);
      const active: ProgrammingService = new ProgrammingService({
        repository: new PrismaProgrammingRepository(database!),
        companies: options.companies,
        devices: options.devices,
        media: options.media,
        layouts: layoutRepository,
        // Both services are created here; the call happens after activation.
        layoutSnapshot: (tx, companyId, layoutId, reach) =>
          layoutService.publicationSnapshot(tx, companyId, layoutId, reach),
      });
      if (publicationFacts) active.onPublicationFacts(publicationFacts);
      service = active;
      const layoutService: LayoutService = new LayoutService({
        repository: layoutRepository,
        companies: options.companies,
        catalogs: options.catalogs,
        media: options.media,
        programs: active,
      });
      layouts = layoutService;
      return {
        name: "programming",
        register: (app) => {
          registerProgrammingRoutes(
            app,
            active,
            options.sessions,
            options.limits,
          );
          registerLayoutRoutes(
            app,
            layoutService,
            options.sessions,
            options.limits,
          );
        },
      };
    },
  };
  return { module, programming };
}
