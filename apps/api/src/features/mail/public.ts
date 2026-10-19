// The mail module's public capability surface (ADR-0026). Producers import
// only this file: they register the templates they own and enqueue or cancel
// messages inside their own database transactions.
import type { Prisma } from "../../generated/prisma/client.js";
import type { DeliveryState, NewMessage } from "./prisma-repository.js";

export type { DeliveryState, NewMessage } from "./prisma-repository.js";
export {
  escapeHtml,
  type MailLocale,
  type MailTemplate,
  type RenderedEmail,
} from "./domain.js";

export type MailOutboxPort = Readonly<{
  /**
   * Records a message in the producer's transaction; it is delivered at
   * least once after that transaction commits, and never if it rolls back.
   */
  enqueue(tx: Prisma.TransactionClient, message: NewMessage): Promise<string>;
  /** Cancels a still-pending message in the producer's transaction. */
  cancel(tx: Prisma.TransactionClient, messageId: string): Promise<void>;
  /** Current delivery state of the given messages; deleted ones are absent. */
  states(messageIds: readonly string[]): Promise<Map<string, DeliveryState>>;
  /** Asks the dispatcher for a prompt pass after the producer committed. */
  wake(): void;
}>;
