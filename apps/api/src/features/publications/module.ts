import type { ApiModule } from "../../module.js";
import type { CatalogPort } from "../catalogs/public.js";
import type { DevicePort } from "../devices/public.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { MediaPort, MediaReference } from "../media/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import type { ProgrammingPort } from "../programming/public.js";
import { publicationOperations } from "./contracts.js";
import { publicationErrors } from "./errors.js";
import { PricePublisher, queuePriceChange } from "./price-processor.js";
import { PrismaPriceIntentRepository } from "./price-repository.js";
import {
  PrismaPublicationRepository,
  programIsPublished,
  publicationMediaReferences,
} from "./prisma-repository.js";
import {
  registerPublicationRoutes,
  type PublicationRouteLimits,
} from "./routes.js";
import { PublicationService } from "./service.js";

const maintenanceIntervalMs = 60 * 60_000;

/**
 * Composes publications and screen synchronization (the publication and
 * synchronization design, ADR-0030) over the organizations, devices, media
 * and programming ports. Retained publications protect their media from
 * deletion, and assignments ask whether a destination is published; both
 * hooks query in the caller's transaction, so they hold even while this
 * module is unmounted for lack of signing keys. Price changes queue
 * intents through the catalogs port in the change's transaction, which
 * also holds while unmounted, and the price publisher turns due intents
 * into generations. Hourly maintenance prunes publications past their
 * retention, old report transitions and finished intents; `manual` leaves
 * the publisher and maintenance to tests.
 */
export function createPublicationsModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  devices: DevicePort;
  media: MediaPort;
  programming: ProgrammingPort;
  catalogs: CatalogPort;
  limits?: PublicationRouteLimits;
  manual?: boolean;
}): {
  module: ApiModule;
  /** Runs maintenance now; for tests and operational recovery. */
  maintain(): Promise<{ pruned: number; events: number }>;
  /** Processes one batch of due price intents now; for tests. */
  publishPrices(): Promise<number>;
} {
  let publisher: PricePublisher | undefined;
  let service: PublicationService | undefined;
  options.media.registerReferenceGuard(
    "publication",
    async (tx, companyId, id) =>
      (await publicationMediaReferences(tx, companyId, id)).flatMap(
        (row): MediaReference[] =>
          row.branchIds.length === 0
            ? [{ kind: "publication", branchId: null }]
            : row.branchIds.map((branchId) => ({
                kind: "publication",
                branchId,
              })),
      ),
  );
  options.programming.onPublicationFacts(programIsPublished);
  options.catalogs.onPriceChange(queuePriceChange);
  const module: ApiModule = {
    name: "publications",
    tag: "Publications",
    requires: ["database", "syncSigning"],
    requiresModules: [
      "identity",
      "organizations",
      "devices",
      "media",
      "catalogs",
      "programming",
    ],
    operations: publicationOperations,
    errors: publicationErrors,
    activate: ({ database, syncSigning }) => {
      // Activation guarantees the database, the signing keys and modules.
      const intents = new PrismaPriceIntentRepository(database!);
      const active = new PublicationService({
        repository: new PrismaPublicationRepository(database!),
        companies: options.companies,
        devices: options.devices,
        media: options.media,
        programming: options.programming,
        catalogs: options.catalogs,
        intents,
        keys: syncSigning!.keys,
      });
      service = active;
      const prices = new PricePublisher({ service: active, intents });
      publisher = prices;
      return {
        name: "publications",
        register: (app) => {
          registerPublicationRoutes(
            app,
            active,
            options.sessions,
            options.limits,
          );
          if (options.manual) return;
          let timer: NodeJS.Timeout | undefined;
          app.addHook("onReady", () => {
            prices.start(app.log);
            timer = setInterval(() => {
              Promise.all([active.maintain(), prices.purge()]).then(
                ([done, intents]) => {
                  if (done.pruned > 0 || done.events > 0 || intents > 0)
                    app.log.info(
                      { ...done, intents },
                      "publication_maintenance_done",
                    );
                },
                (error: unknown) =>
                  app.log.error(
                    {
                      errorType:
                        error instanceof Error ? error.name : typeof error,
                    },
                    "publication_maintenance_failed",
                  ),
              );
            }, maintenanceIntervalMs);
            timer.unref();
            return Promise.resolve();
          });
          app.addHook("preClose", () => {
            clearInterval(timer);
            return prices.stop();
          });
        },
      };
    },
  };
  return {
    module,
    maintain: () => {
      if (!service) throw new Error("The publications module is not active");
      return service.maintain();
    },
    publishPrices: () => {
      if (!publisher) throw new Error("The publications module is not active");
      return publisher.runOnce();
    },
  };
}
