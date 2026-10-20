import type { ApiModule } from "../../module.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { MediaPort } from "../media/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import { catalogOperations } from "./contracts.js";
import { catalogErrors } from "./errors.js";
import { PrismaCatalogRepository } from "./prisma-repository.js";
import { registerCatalogRoutes, type CatalogRouteLimits } from "./routes.js";
import { CatalogService } from "./service.js";

/**
 * Composes typed catalogs, their items, prices and promotions (the catalog
 * and composition design, ADR-0032) over the organizations and media ports.
 * Item values protect the media they name from deletion.
 */
export function createCatalogsModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  media: MediaPort;
  limits?: CatalogRouteLimits;
}): { module: ApiModule } {
  let service: CatalogService | undefined;
  options.media.registerReferenceGuard("catalog-record", (tx, companyId, id) =>
    service ? service.mediaReferences(tx, companyId, id) : Promise.resolve([]),
  );
  const module: ApiModule = {
    name: "catalogs",
    tag: "Catalogs",
    requires: ["database"],
    requiresModules: ["identity", "organizations", "media"],
    operations: catalogOperations,
    errors: catalogErrors,
    activate: ({ database }) => {
      // Activation guarantees the database and the required modules.
      const active = new CatalogService({
        repository: new PrismaCatalogRepository(database!),
        companies: options.companies,
        media: options.media,
      });
      service = active;
      return {
        name: "catalogs",
        register: (app) =>
          registerCatalogRoutes(app, active, options.sessions, options.limits),
      };
    },
  };
  return { module };
}
