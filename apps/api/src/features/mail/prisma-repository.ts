import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  finalRetentionDays,
  leaseMs,
  type FailureClass,
  type MailLocale,
} from "./domain.js";
import type { MailKeyRing } from "./mail-crypto.js";

export type DeliveryState = "PENDING" | "SENT" | "FAILED" | "CANCELLED";

/** A message a producer asks to deliver; it commits with the producer's change. */
export type NewMessage = Readonly<{
  producer: string;
  producerReference: string;
  template: string;
  locale: MailLocale;
  recipient: string;
  parameters: Readonly<Record<string, string>>;
  /** Unsealed only when the message is rendered; erased at its final state. */
  secret?: string;
}>;

/** A claimed pending message; `lease` is the claim's ownership token. */
export type ClaimedMessage = Readonly<{
  id: string;
  template: string;
  locale: MailLocale;
  recipient: string;
  parameters: Readonly<Record<string, string>>;
  sealedSecret: Uint8Array | null;
  attempts: number;
  lease: Date;
}>;

/** PostgreSQL persistence of the outbound-email outbox. */
export class PrismaMailRepository {
  readonly #db: Database;
  readonly #keys: MailKeyRing;

  constructor(database: Database, keys: MailKeyRing) {
    this.#db = database;
    this.#keys = keys;
  }

  /** Inserts a pending message inside the producer's transaction. */
  async enqueue(
    tx: Prisma.TransactionClient,
    message: NewMessage,
  ): Promise<string> {
    const id = randomUUID();
    const sealed =
      message.secret === undefined ? null : this.#keys.seal(message.secret, id);
    await tx.$executeRaw`
      INSERT INTO outbound_emails (id, producer, producer_reference, template, locale,
        recipient, parameters, sealed_secret)
      VALUES (${id}::uuid, ${message.producer}, ${message.producerReference}::uuid,
        ${message.template}, ${message.locale}, ${message.recipient},
        ${JSON.stringify(message.parameters)}::jsonb, ${sealed})`;
    return id;
  }

  /** Cancels a still-pending message inside the producer's transaction. */
  async cancel(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE outbound_emails
      SET status = 'CANCELLED', sealed_secret = NULL, finalized_at = statement_timestamp()
      WHERE id = ${id}::uuid AND status = 'PENDING'`;
  }

  /** Delivery state of the given messages; deleted ones are absent. */
  async states(ids: readonly string[]): Promise<Map<string, DeliveryState>> {
    if (ids.length === 0) return new Map();
    const rows = await this.#db.$queryRaw<
      { id: string; status: DeliveryState }[]
    >`
      SELECT id, status::text AS status FROM outbound_emails
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
    return new Map(rows.map((row) => [row.id, row.status]));
  }

  /**
   * Claims up to `limit` due pending messages under a fresh lease. Rows
   * another dispatcher holds are skipped, never waited for.
   */
  async claim(limit: number): Promise<ClaimedMessage[]> {
    const rows = await this.#db.$queryRaw<
      {
        id: string;
        template: string;
        locale: MailLocale;
        recipient: string;
        parameters: Record<string, string>;
        sealed_secret: Uint8Array | null;
        attempts: number;
        lease_expires_at: Date;
      }[]
    >`
      UPDATE outbound_emails
      SET lease_expires_at = statement_timestamp() + make_interval(secs => ${leaseMs / 1000}),
        attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbound_emails
        WHERE status = 'PENDING' AND next_attempt_at <= statement_timestamp()
          AND (lease_expires_at IS NULL OR lease_expires_at <= statement_timestamp())
        ORDER BY next_attempt_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, template, locale, recipient, parameters, sealed_secret, attempts,
        lease_expires_at`;
    return rows.map((row) => ({
      id: row.id,
      template: row.template,
      locale: row.locale,
      recipient: row.recipient,
      parameters: row.parameters,
      sealedSecret: row.sealed_secret,
      attempts: row.attempts,
      lease: row.lease_expires_at,
    }));
  }

  openSecret(message: ClaimedMessage): string | null {
    return message.sealedSecret
      ? this.#keys.open(message.sealedSecret, message.id)
      : null;
  }

  /**
   * Records the outcome of a claimed attempt. It applies only while the
   * claim is still current and the message pending, so a stale dispatcher
   * or a cancellation during the attempt is never overwritten.
   */
  async complete(
    message: ClaimedMessage,
    outcome:
      | { state: "SENT" }
      | {
          state: "FAILED";
          failure: FailureClass;
          replyCode: number | null;
        }
      | {
          state: "RETRY";
          delayMs: number;
          failure: FailureClass;
          replyCode: number | null;
        },
  ): Promise<boolean> {
    const guard = Prisma.sql`id = ${message.id}::uuid AND status = 'PENDING'
      AND lease_expires_at = ${message.lease}::timestamptz`;
    const updated =
      outcome.state === "SENT"
        ? await this.#db.$executeRaw`
            UPDATE outbound_emails
            SET status = 'SENT', sealed_secret = NULL, finalized_at = statement_timestamp(),
              lease_expires_at = NULL
            WHERE ${guard}`
        : outcome.state === "FAILED"
          ? await this.#db.$executeRaw`
              UPDATE outbound_emails
              SET status = 'FAILED', sealed_secret = NULL, finalized_at = statement_timestamp(),
                lease_expires_at = NULL, last_failure = ${outcome.failure},
                last_reply_code = ${outcome.replyCode}
              WHERE ${guard}`
          : await this.#db.$executeRaw`
              UPDATE outbound_emails
              SET next_attempt_at = statement_timestamp() + make_interval(secs => ${outcome.delayMs / 1000}),
                lease_expires_at = NULL, last_failure = ${outcome.failure},
                last_reply_code = ${outcome.replyCode}
              WHERE ${guard}`;
    return updated === 1;
  }

  /** Age of the oldest due pending message and the count per state. */
  async backlog(): Promise<{
    oldestDueSeconds: number;
    counts: Record<DeliveryState, number>;
  }> {
    const [oldest] = await this.#db.$queryRaw<{ age: number | null }[]>`
      SELECT EXTRACT(EPOCH FROM statement_timestamp() - min(next_attempt_at))::float8 AS age
      FROM outbound_emails
      WHERE status = 'PENDING' AND next_attempt_at <= statement_timestamp()`;
    const rows = await this.#db.$queryRaw<
      { status: DeliveryState; count: number }[]
    >`
      SELECT status::text AS status, count(*)::int AS count FROM outbound_emails GROUP BY status`;
    const counts = { PENDING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return { oldestDueSeconds: Math.max(0, oldest?.age ?? 0), counts };
  }

  /** Deletes up to `limit` final messages past their retention period. */
  async purge(limit: number): Promise<number> {
    return this.#db.$executeRaw`
      DELETE FROM outbound_emails WHERE id IN (
        SELECT id FROM outbound_emails
        WHERE status <> 'PENDING'
          AND finalized_at < statement_timestamp() - make_interval(days => ${finalRetentionDays})
        ORDER BY finalized_at LIMIT ${limit})`;
  }
}
