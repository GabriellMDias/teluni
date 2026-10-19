import { metrics } from "@opentelemetry/api";
import type { Logger } from "pino";
import { retryDelay, type MailTemplate, type RenderedEmail } from "./domain.js";
import type {
  ClaimedMessage,
  PrismaMailRepository,
} from "./prisma-repository.js";
import type { MailTransport } from "./smtp.js";

const meter = metrics.getMeter("teluni-mail");
const outcomes = meter.createCounter("teluni.mail.attempts", {
  description: "Outbound email delivery attempts by outcome.",
});
const sendDuration = meter.createHistogram("teluni.mail.send.duration", {
  description: "Duration of one SMTP submission.",
  unit: "s",
});
const oldestDue = meter.createObservableGauge("teluni.mail.oldest_due_age", {
  description: "Age of the oldest due pending outbound email.",
  unit: "s",
});
const messagesByState = meter.createObservableGauge("teluni.mail.messages", {
  description: "Outbound email messages by state.",
});

export type DispatcherOptions = Readonly<{
  repository: PrismaMailRepository;
  transport: MailTransport;
  templates: ReadonlyMap<string, MailTemplate>;
  /** Producer upkeep run with the dispatcher's own maintenance. */
  maintenance?: readonly (() => Promise<void>)[];
  pollMs?: number;
  batchSize?: number;
  /** How often backlog metrics refresh and retention cleanup runs. */
  maintenanceMs?: number;
  random?: () => number;
  /** Logger used before `start` supplies the server's. */
  log?: Logger;
}>;

/**
 * Claims and delivers due messages inside the API process. Several
 * dispatchers may run against one database; leases keep each claim
 * exclusive. Stopping ends claiming and waits for in-flight submissions.
 */
export class MailDispatcher {
  readonly #options: Required<Omit<DispatcherOptions, "log">>;
  #log: Logger | undefined;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;
  #stopped = true;
  #lastMaintenance = 0;
  #backlog = {
    oldestDueSeconds: 0,
    counts: { PENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 },
  };
  #failingSince: number | undefined;

  constructor({ log, ...options }: DispatcherOptions) {
    this.#log = log;
    this.#options = {
      pollMs: 2000,
      batchSize: 5,
      maintenanceMs: 60_000,
      random: Math.random,
      maintenance: [],
      ...options,
    };
    oldestDue.addCallback((result) =>
      result.observe(this.#backlog.oldestDueSeconds),
    );
    messagesByState.addCallback((result) => {
      for (const [state, count] of Object.entries(this.#backlog.counts))
        result.observe(count, { state });
    });
  }

  start(log: Logger): void {
    this.#log = log;
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#schedule(0);
  }

  /** Asks for a prompt pass, for example after a producer's commit. */
  wake(): void {
    if (this.#stopped || this.#running) return;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#running;
    this.#options.transport.close();
  }

  /** Delivers one batch; returns how many messages it claimed. */
  async runOnce(): Promise<number> {
    const { repository, batchSize } = this.#options;
    if (Date.now() - this.#lastMaintenance >= this.#options.maintenanceMs) {
      this.#lastMaintenance = Date.now();
      this.#backlog = await repository.backlog();
      const purged = await repository.purge(500);
      if (purged > 0) this.#log?.info({ purged }, "mail_messages_purged");
      for (const task of this.#options.maintenance) await task();
    }
    const claimed = await repository.claim(batchSize);
    for (const message of claimed) await this.#deliver(message);
    return claimed.length;
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
    let next = this.#options.pollMs;
    try {
      const claimed = await this.runOnce();
      if (this.#failingSince !== undefined) {
        this.#log?.info("mail_dispatcher_recovered");
        this.#failingSince = undefined;
      }
      if (claimed === this.#options.batchSize) next = 0;
    } catch (error) {
      // One diagnostic per outage, not per poll.
      if (this.#failingSince === undefined) {
        this.#failingSince = Date.now();
        this.#log?.error(
          { errorType: error instanceof Error ? error.name : typeof error },
          "mail_dispatcher_failed",
        );
      }
      next = Math.min(30_000, this.#options.pollMs * 5);
    }
    this.#schedule(next);
  }

  async #deliver(message: ClaimedMessage): Promise<void> {
    const { repository, transport, templates, random } = this.#options;
    let rendered: RenderedEmail;
    try {
      const template = templates.get(message.template);
      if (!template) throw new Error("Unknown mail template");
      rendered = template({
        locale: message.locale,
        parameters: message.parameters,
        secret: repository.openSecret(message),
      });
    } catch (error) {
      // An unknown template or key, or a template defect, cannot succeed later.
      await repository.complete(message, {
        state: "FAILED",
        failure: "unexpected",
        replyCode: null,
      });
      outcomes.add(1, { outcome: "failed", failure: "unexpected" });
      this.#log?.error(
        {
          messageId: message.id,
          template: message.template,
          errorType: error instanceof Error ? error.name : typeof error,
        },
        "mail_message_unrenderable",
      );
      return;
    }
    const started = performance.now();
    const outcome = await transport.send({
      messageId: message.id,
      to: message.recipient,
      ...rendered,
    });
    sendDuration.record((performance.now() - started) / 1000);
    if (outcome.kind === "sent") {
      await repository.complete(message, { state: "SENT" });
      outcomes.add(1, { outcome: "sent" });
      this.#log?.info(
        { messageId: message.id, attempts: message.attempts },
        "mail_message_sent",
      );
      return;
    }
    const delayMs =
      outcome.kind === "transient"
        ? retryDelay(message.attempts, random)
        : null;
    if (delayMs === null) {
      await repository.complete(message, {
        state: "FAILED",
        failure: outcome.failure,
        replyCode: outcome.replyCode,
      });
      outcomes.add(1, { outcome: "failed", failure: outcome.failure });
      this.#log?.warn(
        {
          messageId: message.id,
          attempts: message.attempts,
          failure: outcome.failure,
          replyCode: outcome.replyCode,
        },
        "mail_message_failed",
      );
      return;
    }
    await repository.complete(message, {
      state: "RETRY",
      delayMs,
      failure: outcome.failure,
      replyCode: outcome.replyCode,
    });
    outcomes.add(1, { outcome: "retry", failure: outcome.failure });
    this.#log?.warn(
      {
        messageId: message.id,
        attempts: message.attempts,
        failure: outcome.failure,
        replyCode: outcome.replyCode,
      },
      "mail_message_retry",
    );
  }
}
