import type { ApiModule } from "../../module.js";
import { MailDispatcher } from "./dispatcher.js";
import type { MailTemplate } from "./domain.js";
import { MailKeyRing } from "./mail-crypto.js";
import { PrismaMailRepository } from "./prisma-repository.js";
import type { MailOutboxPort } from "./public.js";
import { createSmtpTransport, type MailTransport } from "./smtp.js";

/**
 * Composes the transactional-email module. Producers register their
 * templates before activation and use the outbox port once it is active;
 * they declare `requiresModules: ["mail"]` so they never activate without it.
 * The dispatcher starts when the server is ready and stops during shutdown.
 */
export function createMailModule(
  options: {
    /** Replaces SMTP, for tests that inject delivery outcomes. */
    transport?: MailTransport;
    pollMs?: number;
    /** How often upkeep runs; tests use 0 to run it on every pass. */
    maintenanceMs?: number;
    /** Never dispatch in the background; tests then call `runOnce`. */
    manual?: boolean;
    random?: () => number;
  } = {},
): {
  module: ApiModule;
  outbox: MailOutboxPort;
  registerTemplate(name: string, template: MailTemplate): void;
  /** Adds producer upkeep (such as retention) to the dispatcher's maintenance. */
  registerMaintenance(task: () => Promise<void>): void;
  /** Delivers one due batch now; for tests and operational recovery. */
  runOnce(): Promise<number>;
} {
  const templates = new Map<string, MailTemplate>();
  const maintenance: (() => Promise<void>)[] = [];
  let active:
    | { repository: PrismaMailRepository; dispatcher: MailDispatcher }
    | undefined;
  const require = () => {
    if (!active) throw new Error("The mail module is not active");
    return active;
  };
  const outbox: MailOutboxPort = {
    enqueue: (tx, message) => {
      if (!templates.has(message.template))
        throw new Error("Unknown mail template");
      return require().repository.enqueue(tx, message);
    },
    cancel: (tx, messageId) => require().repository.cancel(tx, messageId),
    states: (messageIds) => require().repository.states(messageIds),
    wake: () => active?.dispatcher.wake(),
  };
  const module: ApiModule = {
    name: "mail",
    tag: "Mail",
    requires: ["database", "mail"],
    operations: [],
    errors: {},
    activate: ({ database, mail }) => {
      // Activation guarantees the database and the mail settings.
      const settings = mail!;
      const repository = new PrismaMailRepository(
        database!,
        new MailKeyRing(settings.keys),
      );
      const dispatcher = new MailDispatcher({
        repository,
        transport: options.transport ?? createSmtpTransport(settings),
        templates,
        maintenance,
        ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
        ...(options.maintenanceMs === undefined
          ? {}
          : { maintenanceMs: options.maintenanceMs }),
        ...(options.random ? { random: options.random } : {}),
      });
      active = { repository, dispatcher };
      return {
        name: "mail",
        register: (app) => {
          if (options.manual) return;
          app.addHook("onReady", () => {
            dispatcher.start(app.log);
            return Promise.resolve();
          });
          app.addHook("preClose", () => dispatcher.stop());
        },
      };
    },
  };
  return {
    module,
    outbox,
    registerTemplate(name, template) {
      if (templates.has(name)) throw new Error("Duplicate mail template");
      templates.set(name, template);
    },
    registerMaintenance(task) {
      maintenance.push(task);
    },
    runOnce: () => require().dispatcher.runOnce(),
  };
}
