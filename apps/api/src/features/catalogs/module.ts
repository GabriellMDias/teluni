import type { ApiModule } from "../../module.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { MediaPort } from "../media/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import { catalogOperations } from "./contracts.js";
import { catalogErrors } from "./errors.js";
import type {
  CatalogPort,
  CatalogUsageGuard,
  PriceChangeListener,
} from "./public.js";
import { PrismaCatalogRepository } from "./prisma-repository.js";
import { registerCatalogRoutes, type CatalogRouteLimits } from "./routes.js";
import { CatalogService } from "./service.js";

/**
 * Composes typed catalogs, their items, prices and promotions (the catalog
 * and composition design, ADR-0032) over the organizations and media ports.
 * Item values protect the media they name from deletion. Programming's
 * layouts use the returned port to bind catalogs and protect what they bind,
 * and the publications module hears of every price change through it.
 */
export function createCatalogsModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  media: MediaPort;
  limits?: CatalogRouteLimits;
}): { module: ApiModule; catalogs: CatalogPort } {
  let service: CatalogService | undefined;
  const guards: CatalogUsageGuard[] = [];
  const priceListeners: PriceChangeListener[] = [];
  const require = () => {
    if (!service) throw new Error("The catalogs module is not active");
    return service;
  };
  const catalogs: CatalogPort = {
    registerUsageGuard: (guard) => guards.push(guard),
    onPriceChange: (listener) => priceListeners.push(listener),
    requireBindable: (tx, access, ids) =>
      require().requireBindable(tx, access, ids),
    describe: (companyId, ids) => require().describeCatalogs(companyId, ids),
    visible: (access, catalogId) => require().visibleCatalog(access, catalogId),
    priceSequences: (tx, companyId, ids) =>
      require().priceSequences(tx, companyId, ids),
    viewData: (companyId, catalogId) =>
      require().viewData(companyId, catalogId),
  };
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
        guards,
        priceListeners,
      });
      service = active;
      return {
        name: "catalogs",
        register: (app) =>
          registerCatalogRoutes(app, active, options.sessions, options.limits),
      };
    },
  };
  return { module, catalogs };
}
