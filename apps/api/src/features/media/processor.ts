import { open } from "node:fs/promises";
import { metrics } from "@opentelemetry/api";
import type { Logger } from "pino";
import {
  declaredTypes,
  detectFormat,
  inspect,
  MediaRejection,
  mediaPolicy,
  requireDeclaredFormat,
  verifyDisplay,
  type DeclaredType,
} from "./domain.js";
import {
  probe,
  probeOutput,
  renderImage,
  renderVideo,
  verifyTools,
  type MediaTools,
} from "./ffmpeg.js";
import type {
  PrismaMediaRepository,
  ProcessingJob,
} from "./prisma-repository.js";
import type { MediaService } from "./service.js";
import type { MediaObjectStore } from "./storage.js";

const meter = metrics.getMeter("teluni-media");
const outcomes = meter.createCounter("teluni.media.processing", {
  description: "Media processing attempts by outcome.",
});
const duration = meter.createHistogram("teluni.media.processing.duration", {
  description: "Duration of one media processing attempt.",
  unit: "s",
});

export type ProcessorOptions = Readonly<{
  repository: PrismaMediaRepository;
  service: MediaService;
  store: MediaObjectStore;
  tools: MediaTools;
  concurrency: number;
  pollMs?: number;
  maintenanceMs?: number;
  environment: "development" | "test" | "production";
}>;

/**
 * Processes uploaded media inside the API process (ADR-0028): claims items
 * with leases, inspects and converts them only through FFmpeg child
 * processes, and runs upkeep (expired uploads, trash purge, work and
 * orphan sweeps). Several processes may share one database.
 */
export class MediaProcessor {
  readonly #options: Required<ProcessorOptions>;
  #log: Logger | undefined;
  #timer: NodeJS.Timeout | undefined;
  #running = new Set<Promise<void>>();
  #stopped = true;
  #toolsReady = false;
  #lastMaintenance = 0;
  #lastOrphanSweep = 0;
  #failing = false;
  #ticking = false;

  constructor(options: ProcessorOptions) {
    this.#options = { pollMs: 2000, maintenanceMs: 60_000, ...options };
  }

  /** Verifies the tools; production refuses to start without them. */
  async prepare(log: Logger): Promise<void> {
    this.#log = log;
    await this.#options.store.initialize();
    const cwd = await this.#options.store.workDirectory();
    try {
      this.#toolsReady = await verifyTools(this.#options.tools, cwd);
    } finally {
      await this.#options.store.removeWork(cwd);
    }
    if (!this.#toolsReady) {
      log.error("media_tools_unavailable");
      if (this.#options.environment === "production")
        throw new Error("FFmpeg 6.1 or later is required for media processing");
    }
  }

  start(log: Logger): void {
    this.#log = log;
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#schedule(0);
  }

  wake(): void {
    if (this.#stopped) return;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await Promise.allSettled([...this.#running]);
  }

  /**
   * Claims and processes due items up to the free concurrency. Tests and
   * recovery await the work; the background loop only starts it.
   */
  async runOnce(wait = true): Promise<number> {
    if (Date.now() - this.#lastMaintenance >= this.#options.maintenanceMs) {
      this.#lastMaintenance = Date.now();
      await this.maintain();
    }
    if (!this.#toolsReady) return 0;
    const free = this.#options.concurrency - this.#running.size;
    if (free <= 0) return 0;
    const jobs = await this.#options.repository.claim(free);
    const work = jobs.map((job) => {
      const task = this.#process(job).finally(() => {
        this.#running.delete(task);
        // A free slot may take the next due item at once.
        if (!wait) this.wake();
      });
      this.#running.add(task);
      return task;
    });
    if (wait) await Promise.all(work);
    return jobs.length;
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#tick();
    }, delayMs);
    this.#timer.unref();
  }

  async #tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    let next = this.#options.pollMs;
    try {
      const claimed = await this.runOnce(false);
      if (this.#failing) {
        this.#log?.info("media_processor_recovered");
        this.#failing = false;
      }
      if (claimed > 0 && this.#running.size < this.#options.concurrency)
        next = 0;
    } catch (error) {
      // One diagnostic per outage, not per poll.
      if (!this.#failing) {
        this.#failing = true;
        this.#log?.error(
          { errorType: error instanceof Error ? error.name : typeof error },
          "media_processor_failed",
        );
      }
      next = Math.min(30_000, this.#options.pollMs * 5);
    } finally {
      this.#ticking = false;
    }
    this.#schedule(next);
  }

  async #process(job: ProcessingJob): Promise<void> {
    const { repository, store, tools } = this.#options;
    const started = performance.now();
    const directory = await store.workDirectory();
    try {
      const declared = declaredTypes[job.declaredContentType as DeclaredType];
      if (!declared) throw new MediaRejection("MEDIA_TYPE_UNSUPPORTED");
      const input = store.pathFor(job.companyId, job.originalSha256);
      const head = Buffer.alloc(16);
      const handle = await open(input, "r");
      try {
        await handle.read(head, 0, 16, 0);
      } finally {
        await handle.close();
      }
      requireDeclaredFormat(declared.format, detectFormat(head));
      const inspection = inspect(
        declared.format,
        await probe(tools, input, declared.format, directory),
      );
      await repository.progress(job, "converting", null);
      let lastReport = 0;
      const rendered =
        inspection.kind === "IMAGE"
          ? await renderImage(
              tools,
              input,
              declared.format,
              inspection,
              directory,
            )
          : await renderVideo(
              tools,
              input,
              declared.format,
              inspection,
              directory,
              (percent) => {
                if (Date.now() - lastReport < 2000) return;
                lastReport = Date.now();
                void repository
                  .progress(job, "converting", percent)
                  .catch(() => undefined);
              },
            );
      await repository.progress(job, "verifying", null);
      const size = verifyDisplay(
        inspection.kind,
        await probeOutput(tools, rendered.display.path, directory),
        inspection.hasAudio,
      );
      const display = await store.seal(rendered.display.path);
      const thumbnail = await store.seal(rendered.thumbnail.path);
      if (display.size > mediaPolicy.maxRenditionBytes)
        throw new MediaRejection("MEDIA_CONVERSION_FAILED");
      const finished = await repository.finishReady(job, {
        display: { ...display, contentType: rendered.display.contentType },
        thumbnail: {
          ...thumbnail,
          contentType: rendered.thumbnail.contentType,
        },
        width: size.width,
        height: size.height,
        durationMs: inspection.durationMs,
        hasAudio: inspection.kind === "VIDEO" ? inspection.hasAudio : null,
      });
      outcomes.add(1, {
        outcome: finished ? "ready" : "superseded",
        kind: job.kind,
      });
      this.#log?.info(
        { assetId: job.id, kind: job.kind, attempt: job.attempt },
        "media_ready",
      );
    } catch (error) {
      if (error instanceof MediaRejection) {
        await repository.finishRejected(job, error.reason);
        outcomes.add(1, {
          outcome: "rejected",
          reason: error.reason,
          kind: job.kind,
        });
        this.#log?.info(
          { assetId: job.id, kind: job.kind, reason: error.reason },
          "media_rejected",
        );
      } else {
        await repository.finishFailed(job);
        outcomes.add(1, { outcome: "failed", kind: job.kind });
        this.#log?.warn(
          {
            assetId: job.id,
            attempt: job.attempt,
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "media_processing_failed",
        );
      }
    } finally {
      duration.record((performance.now() - started) / 1000, { kind: job.kind });
      await store.removeWork(directory);
    }
  }

  /** Upkeep: expired uploads, due purges, stale work and orphan files. */
  async maintain(): Promise<void> {
    const { repository, service, store } = this.#options;
    for (const due of await repository.expiredUploads(100))
      await repository.transaction(async (tx) => {
        const current = await repository.lock(tx, due.companyId, due.id);
        if (current?.status === "UPLOADING")
          await repository.purgeLocked(tx, current, "media.discarded");
      });
    let kept = 0;
    for (const due of await repository.duePurges(100))
      await repository.transaction(async (tx) => {
        const current = await repository.lock(tx, due.companyId, due.id);
        if (current?.status !== "DELETED") return;
        // Retention expiry alone never deletes protected media.
        if ((await service.references(tx, due.companyId, due.id)).length > 0) {
          kept += 1;
          return;
        }
        await repository.purgeLocked(tx, current, "media.purged");
      });
    if (kept > 0) this.#log?.info({ kept }, "media_purge_deferred");
    const day = 24 * 60 * 60_000;
    await store.sweepWork(day);
    if (Date.now() - this.#lastOrphanSweep >= 60 * 60_000) {
      this.#lastOrphanSweep = Date.now();
      let removed = 0;
      for await (const file of store.list())
        if (
          file.ageMs > day &&
          !(await repository.objectExists(file.companyId, file.sha256))
        ) {
          await store.delete(file.companyId, file.sha256);
          removed += 1;
        }
      if (removed > 0) this.#log?.warn({ removed }, "media_orphans_removed");
    }
  }
}
