import { metrics } from "@opentelemetry/api";
import type { Logger } from "pino";
import type { Prisma } from "../../generated/prisma/client.js";
import type { PriceChangeListener } from "../catalogs/public.js";
import { decide } from "../organizations/public.js";
import { priceIntentPolicy, priceRetryDelayMs } from "./domain.js";
import {
  programsShowing,
  queueIntent,
  type PrismaPriceIntentRepository,
} from "./price-repository.js";
import { lockPublicationsShared } from "./prisma-repository.js";
import type { PublicationService } from "./service.js";

const meter = metrics.getMeter("teluni-publications");
const outcomes = meter.createCounter("teluni.price_publications.outcomes", {
  description: "Processed price publication intents by outcome.",
});

/**
 * The price change listener (catalog and composition design, automatic
 * price publication). In the change's transaction, under the company's
 * publication lock taken shared, it finds the programs whose latest
 * publication copies the catalog and that the change reaches (a branch's
 * price only those reaching that branch, so a local price stays local),
 * refuses the change unless the author may publish every one of them, and
 * queues one intent per program. It uses only the transaction, so it holds
 * while the module is unmounted.
 */
export const queuePriceChange: PriceChangeListener = async (
  tx: Prisma.TransactionClient,
  { access, catalogId, branchId, sequence },
) => {
  await lockPublicationsShared(tx, access.companyId);
  const targets = await programsShowing(
    tx,
    access.companyId,
    catalogId,
    branchId,
  );
  const allowed = targets.every(({ branchIds }) =>
    branchIds.length === 0
      ? decide(access, "publications.publish") === "allow"
      : branchIds.every(
          (branchId) =>
            decide(access, "publications.publish", branchId) === "allow",
        ),
  );
  if (!allowed) return false;
  for (const { programId } of targets)
    await queueIntent(
      tx,
      access.companyId,
      programId,
      catalogId,
      sequence,
      access.membershipId,
    );
  return true;
};

/**
 * Claims due intents and publishes them inside the API process. Several
 * processors may run against one database; leases keep each claim
 * exclusive. Stopping ends claiming and waits for the work in progress.
 */
export class PricePublisher {
  readonly #service: PublicationService;
  readonly #intents: PrismaPriceIntentRepository;
  readonly #pollMs: number;
  #log: Logger | undefined;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;
  #stopped = true;
  #failingSince: number | undefined;

  constructor(options: {
    service: PublicationService;
    intents: PrismaPriceIntentRepository;
    pollMs?: number;
  }) {
    this.#service = options.service;
    this.#intents = options.intents;
    this.#pollMs = options.pollMs ?? priceIntentPolicy.pollMs;
  }

  start(log: Logger): void {
    this.#log = log;
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
  }

  /** Processes one batch; returns how many intents it claimed. */
  async runOnce(): Promise<number> {
    const claimed = await this.#intents.claim(priceIntentPolicy.batchSize);
    for (const intent of claimed) {
      let result: string;
      try {
        const outcome = await this.#service.publishPrices(intent);
        result = "state" in outcome ? outcome.state : "RETRY";
      } catch (error) {
        // An unexpected failure retries with back-off; one diagnostic each.
        this.#log?.error(
          {
            intentId: intent.id,
            errorType: error instanceof Error ? error.name : typeof error,
          },
          "price_publication_failed",
        );
        await this.#intents.finish(null, intent, {
          retryInMs: priceRetryDelayMs(intent.attempts),
          reason: "ERROR",
        });
        result = "ERROR";
      }
      outcomes.add(1, { outcome: result });
    }
    return claimed.length;
  }

  /** Deletes finished intents past their retention. */
  purge(): Promise<number> {
    return this.#intents.purge(500);
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#running = this.#tick().finally(() => {
        this.#running = undefined;
      });
    }, delayMs);
    this.#timer.unref();
  }

  async #tick(): Promise<void> {
    let next = this.#pollMs;
    try {
      const claimed = await this.runOnce();
      if (this.#failingSince !== undefined) {
        this.#log?.info("price_publisher_recovered");
        this.#failingSince = undefined;
      }
      if (claimed === priceIntentPolicy.batchSize) next = 0;
    } catch (error) {
      // One diagnostic per outage, not per poll.
      if (this.#failingSince === undefined) {
        this.#failingSince = Date.now();
        this.#log?.error(
          { errorType: error instanceof Error ? error.name : typeof error },
          "price_publisher_unavailable",
        );
      }
    }
    this.#schedule(next);
  }
}
