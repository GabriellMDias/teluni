import type { ApiModule } from "../../module.js";
import type { HumanSessionPort } from "../identity/public.js";
import type { CompanyAccessPort } from "../organizations/public.js";
import { mediaOperations } from "./contracts.js";
import { mediaErrors } from "./errors.js";
import { PrismaMediaRepository } from "./prisma-repository.js";
import { MediaProcessor } from "./processor.js";
import type { MediaPort, MediaReferenceGuard } from "./public.js";
import {
  registerMediaRoutes,
  uploadTimeoutMs,
  type MediaRouteLimits,
} from "./routes.js";
import { MediaService } from "./service.js";
import { MediaObjectStore } from "./storage.js";

/**
 * Composes the media library (ADR-0028) over the identity session boundary
 * and the organizations access port. Modules that reference media register
 * their reference guards on the returned port before activation; the
 * processor starts when the server is ready and stops during shutdown.
 */
export function createMediaModule(options: {
  sessions: HumanSessionPort;
  companies: CompanyAccessPort;
  limits?: MediaRouteLimits;
  /** Never process in the background; tests then call `runOnce`. */
  manual?: boolean;
  pollMs?: number;
}): {
  module: ApiModule;
  media: MediaPort;
  /** Processes due items now; for tests and operational recovery. */
  runOnce(): Promise<number>;
  /** Runs upkeep now (expired uploads, purge, sweeps). */
  maintain(): Promise<void>;
} {
  const guards = new Map<string, MediaReferenceGuard>();
  let active: { service: MediaService; processor: MediaProcessor } | undefined;
  const require = () => {
    if (!active) throw new Error("The media module is not active");
    return active;
  };
  const media: MediaPort = {
    registerReferenceGuard(kind, guard) {
      if (guards.has(kind)) throw new Error("Duplicate media reference guard");
      guards.set(kind, guard);
      active?.service.registerReferenceGuard(kind, guard);
    },
    requireSelectable: (tx, access, assetIds) =>
      require().service.requireSelectable(tx, access, assetIds),
    describe: (companyId, assetIds) =>
      require().service.describe(companyId, assetIds),
    describeForPublication: (tx, companyId, assetIds) =>
      require().service.describeForPublication(tx, companyId, assetIds),
    openObject: (companyId, sha256, range) =>
      require().service.openObject(
        companyId,
        Buffer.from(sha256, "hex"),
        range,
      ),
  };
  const module: ApiModule = {
    name: "media",
    tag: "Media",
    requires: ["database", "mediaStorage"],
    requiresModules: ["identity", "organizations"],
    operations: mediaOperations,
    errors: mediaErrors,
    activate: ({ database, mediaStorage }) => {
      // Activation guarantees the database, the media volume and modules.
      const settings = mediaStorage!;
      const store = new MediaObjectStore(settings.root);
      const repository = new PrismaMediaRepository(database!, store);
      const service = new MediaService({
        repository,
        companies: options.companies,
        store,
        // Called only after activation has created the processor.
        wake: () => processor.wake(),
      });
      for (const [kind, guard] of guards)
        service.registerReferenceGuard(kind, guard);
      const processor = new MediaProcessor({
        repository,
        service,
        store,
        tools: {
          ffmpegPath: settings.ffmpegPath,
          ffprobePath: settings.ffprobePath,
        },
        concurrency: settings.concurrency,
        environment: settings.environment,
        ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
      });
      active = { service, processor };
      return {
        name: "media",
        requestTimeoutMs: uploadTimeoutMs,
        register: (app) => {
          registerMediaRoutes(app, service, options.sessions, options.limits);
          app.addHook("onReady", async () => {
            await processor.prepare(app.log);
            if (!options.manual) processor.start(app.log);
          });
          app.addHook("preClose", () => processor.stop());
        },
      };
    },
  };
  return {
    module,
    media,
    runOnce: () => require().processor.runOnce(),
    maintain: () => require().processor.maintain(),
  };
}
