import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { priceIntentPolicy } from "./domain.js";
import type { CatalogCopy } from "./prisma-repository.js";

export type PriceIntentState =
  "PENDING" | "PUBLISHED" | "SKIPPED" | "BLOCKED" | "FAILED";

export type PriceIntentRecord = Readonly<{
  id: string;
  companyId: string;
  programId: string;
  catalogId: string;
  priceSequence: number;
  authorMembershipId: string;
  authorizedByMembershipId: string | null;
  state: PriceIntentState;
  reason: string | null;
  attempts: number;
  publicationId: string | null;
  /** The generation of the intent's publication, when it names one. */
  generation: number | null;
  createdAt: Date;
  updatedAt: Date;
}>;

/** A claimed pending intent; `lease` is the claim's ownership token. */
export type ClaimedIntent = PriceIntentRecord & Readonly<{ lease: Date }>;

/** How a claimed intent ends, or when it is due again. */
export type IntentOutcome =
  | Readonly<{
      state: "PUBLISHED" | "SKIPPED";
      reason: string | null;
      publicationId: string | null;
      /** The price sequence the program's latest publication now includes. */
      includes: number;
    }>
  | Readonly<{ state: "BLOCKED" | "FAILED"; reason: string }>
  | Readonly<{ retryInMs: number; reason: string }>;

type IntentRow = {
  id: string;
  company_id: string;
  program_id: string;
  catalog_id: string;
  price_sequence: bigint;
  author_membership_id: string;
  authorized_by_membership_id: string | null;
  state: PriceIntentState;
  reason: string | null;
  attempts: number;
  publication_id: string | null;
  generation: number | null;
  created_at: Date;
  updated_at: Date;
};

const intentColumns = Prisma.sql`i.id, i.company_id, i.program_id, i.catalog_id,
  i.price_sequence, i.author_membership_id, i.authorized_by_membership_id,
  i.state, i.reason, i.attempts, i.publication_id, p.generation, i.created_at,
  i.updated_at`;

const intentJoin = Prisma.sql`LEFT JOIN publications p
  ON p.company_id = i.company_id AND p.id = i.publication_id`;

const intent = (row: IntentRow): PriceIntentRecord => ({
  id: row.id,
  companyId: row.company_id,
  programId: row.program_id,
  catalogId: row.catalog_id,
  priceSequence: Number(row.price_sequence),
  authorMembershipId: row.author_membership_id,
  authorizedByMembershipId: row.authorized_by_membership_id,
  state: row.state,
  reason: row.reason,
  attempts: row.attempts,
  publicationId: row.publication_id,
  generation: row.generation,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * The programs whose latest publication copies a catalog, with the
 * branches that publication concerns (none recorded: the whole company).
 * With a branch, only those that reach it: another branch's price stays
 * out of their copies.
 */
export async function programsShowing(
  tx: Prisma.TransactionClient,
  companyId: string,
  catalogId: string,
  branchId: string | null,
): Promise<{ programId: string; branchIds: string[] }[]> {
  const rows = await tx.$queryRaw<
    { program_id: string; branch_ids: string[] }[]
  >`
    SELECT p.program_id, COALESCE(p.branch_ids::text[], '{}') AS branch_ids
    FROM publication_catalogs c
    JOIN publications p ON p.company_id = c.company_id AND p.id = c.publication_id
    WHERE c.company_id = ${companyId}::uuid AND c.catalog_id = ${catalogId}::uuid
      AND p.superseded_at IS NULL
      AND (${branchId}::uuid IS NULL OR cardinality(p.branch_ids) = 0
        OR ${branchId}::uuid = ANY (p.branch_ids))
    ORDER BY p.program_id`;
  return rows.map((row) => ({
    programId: row.program_id,
    branchIds: row.branch_ids,
  }));
}

/**
 * Queues a catalog's prices for a program: inserts a pending intent, or
 * coalesces a newer change into the pending one, which then publishes it
 * on that change's author's authority. A pending intent that already
 * covers the change is left as it is.
 */
export async function queueIntent(
  tx: Prisma.TransactionClient,
  companyId: string,
  programId: string,
  catalogId: string,
  sequence: number,
  authorMembershipId: string,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO price_publication_intents (id, company_id, program_id, catalog_id,
      price_sequence, author_membership_id)
    VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${programId}::uuid,
      ${catalogId}::uuid, ${sequence}::bigint, ${authorMembershipId}::uuid)
    ON CONFLICT (company_id, program_id, catalog_id) WHERE state = 'PENDING'
    DO UPDATE SET
      price_sequence = EXCLUDED.price_sequence,
      author_membership_id = EXCLUDED.author_membership_id,
      authorized_by_membership_id = NULL, reason = NULL, attempts = 0,
      next_attempt_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE price_publication_intents.price_sequence < EXCLUDED.price_sequence`;
}

/**
 * PostgreSQL persistence of price publication intents. Writes that follow a
 * publication run under the company's publication lock; the processor's
 * claims are leases, so several API instances may run it.
 */
export class PrismaPriceIntentRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  /**
   * After a publication of a program: intents for the catalogs it copies
   * whose changes it includes are settled as skipped (`INCLUDED`), except
   * the processor's own intent, which it finishes itself.
   */
  async settle(
    tx: Prisma.TransactionClient,
    companyId: string,
    programId: string,
    copy: CatalogCopy,
    publicationId: string,
    except: string | null,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE price_publication_intents
      SET state = 'SKIPPED', reason = 'INCLUDED', publication_id = ${publicationId}::uuid,
        lease_expires_at = NULL, updated_at = statement_timestamp()
      WHERE company_id = ${companyId}::uuid AND program_id = ${programId}::uuid
        AND catalog_id = ${copy.catalogId}::uuid
        AND state IN ('PENDING', 'BLOCKED', 'FAILED')
        AND price_sequence <= ${copy.priceSequence}::bigint
        AND (${except}::uuid IS NULL OR id <> ${except}::uuid)`;
  }

  /** Claims up to `limit` due pending intents under a fresh lease. */
  async claim(limit: number): Promise<ClaimedIntent[]> {
    const rows = await this.#db.$queryRaw<
      (Omit<IntentRow, "generation"> & { lease_expires_at: Date })[]
    >`
      UPDATE price_publication_intents
      SET lease_expires_at = statement_timestamp() + make_interval(secs => ${priceIntentPolicy.leaseMs / 1000}),
        attempts = attempts + 1, updated_at = statement_timestamp()
      WHERE id IN (
        SELECT id FROM price_publication_intents
        WHERE state = 'PENDING' AND next_attempt_at <= statement_timestamp()
          AND (lease_expires_at IS NULL OR lease_expires_at <= statement_timestamp())
        ORDER BY next_attempt_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, company_id, program_id, catalog_id, price_sequence,
        author_membership_id, authorized_by_membership_id, state, reason,
        attempts, publication_id, created_at, updated_at, lease_expires_at`;
    return rows.map((row) => ({
      ...intent({ ...row, generation: null }),
      lease: row.lease_expires_at,
    }));
  }

  /**
   * Ends or reschedules a claimed intent, if the claim still holds. A
   * finished intent whose sequence grew meanwhile (a later change coalesced
   * into it) becomes due again instead. Returns whether the claim held.
   */
  async finish(
    tx: Prisma.TransactionClient | null,
    claimed: ClaimedIntent,
    outcome: IntentOutcome,
  ): Promise<boolean> {
    const db = tx ?? this.#db;
    const owned = Prisma.sql`id = ${claimed.id}::uuid AND state = 'PENDING'
      AND lease_expires_at = ${claimed.lease}::timestamptz`;
    let count: number;
    if ("retryInMs" in outcome) {
      const final = claimed.attempts >= priceIntentPolicy.maxAttempts;
      count = final
        ? await db.$executeRaw`
            UPDATE price_publication_intents
            SET state = 'FAILED', reason = ${outcome.reason}, lease_expires_at = NULL,
              updated_at = statement_timestamp()
            WHERE ${owned}`
        : await db.$executeRaw`
            UPDATE price_publication_intents
            SET reason = ${outcome.reason}, lease_expires_at = NULL,
              next_attempt_at = statement_timestamp() + make_interval(secs => ${outcome.retryInMs / 1000}),
              updated_at = statement_timestamp()
            WHERE ${owned}`;
    } else if (!("includes" in outcome)) {
      count = await db.$executeRaw`
        UPDATE price_publication_intents
        SET state = ${outcome.state}, reason = ${outcome.reason}, lease_expires_at = NULL,
          updated_at = statement_timestamp()
        WHERE ${owned}`;
    } else {
      count = await db.$executeRaw`
        UPDATE price_publication_intents
        SET state = CASE WHEN price_sequence <= ${outcome.includes}::bigint
            THEN ${outcome.state} ELSE 'PENDING' END,
          reason = CASE WHEN price_sequence <= ${outcome.includes}::bigint
            THEN ${outcome.reason} ELSE NULL END,
          publication_id = CASE WHEN price_sequence <= ${outcome.includes}::bigint
            THEN ${outcome.publicationId}::uuid ELSE NULL END,
          attempts = CASE WHEN price_sequence <= ${outcome.includes}::bigint
            THEN attempts ELSE 0 END,
          next_attempt_at = statement_timestamp(), lease_expires_at = NULL,
          updated_at = statement_timestamp()
        WHERE ${owned}`;
    }
    return count === 1;
  }

  async find(
    companyId: string,
    intentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PriceIntentRecord | null> {
    const [row] = await (tx ?? this.#db).$queryRaw<IntentRow[]>`
      SELECT ${intentColumns} FROM price_publication_intents i ${intentJoin}
      WHERE i.company_id = ${companyId}::uuid AND i.id = ${intentId}::uuid`;
    return row ? intent(row) : null;
  }

  /** A catalog's most recent intents, newest first. */
  async list(
    companyId: string,
    catalogId: string,
    limit: number,
  ): Promise<PriceIntentRecord[]> {
    const rows = await this.#db.$queryRaw<IntentRow[]>`
      SELECT ${intentColumns} FROM price_publication_intents i ${intentJoin}
      WHERE i.company_id = ${companyId}::uuid AND i.catalog_id = ${catalogId}::uuid
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ${limit}`;
    return rows.map(intent);
  }

  /**
   * A blocked or failed intent authorized again: due now on the new
   * member's authority, keeping its author. When the program already has a
   * pending intent for the catalog, that one publishes these prices too, so
   * this one is skipped (`SUPERSEDED`). Locks the intent row.
   */
  async reauthorize(
    tx: Prisma.TransactionClient,
    current: PriceIntentRecord,
    membershipId: string,
  ): Promise<"queued" | "superseded"> {
    const [pending] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM price_publication_intents
      WHERE company_id = ${current.companyId}::uuid AND program_id = ${current.programId}::uuid
        AND catalog_id = ${current.catalogId}::uuid AND state = 'PENDING'
      FOR UPDATE`;
    if (pending) {
      await tx.$executeRaw`
        UPDATE price_publication_intents
        SET state = 'SKIPPED', reason = 'SUPERSEDED', updated_at = statement_timestamp()
        WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid`;
      return "superseded";
    }
    await tx.$executeRaw`
      UPDATE price_publication_intents
      SET state = 'PENDING', authorized_by_membership_id = ${membershipId}::uuid,
        reason = NULL, attempts = 0, publication_id = NULL,
        next_attempt_at = statement_timestamp(), updated_at = statement_timestamp()
      WHERE company_id = ${current.companyId}::uuid AND id = ${current.id}::uuid`;
    return "queued";
  }

  /** Locks an intent for a change by a person; null when it is unknown. */
  async lock(
    tx: Prisma.TransactionClient,
    companyId: string,
    intentId: string,
  ): Promise<PriceIntentRecord | null> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM price_publication_intents
      WHERE company_id = ${companyId}::uuid AND id = ${intentId}::uuid
      FOR UPDATE`;
    return row ? this.find(companyId, intentId, tx) : null;
  }

  /** Deletes finished intents past their retention; returns how many. */
  async purge(limit: number): Promise<number> {
    return this.#db.$executeRaw`
      DELETE FROM price_publication_intents
      WHERE id IN (
        SELECT id FROM price_publication_intents
        WHERE state <> 'PENDING'
          AND updated_at < statement_timestamp() - make_interval(days => ${priceIntentPolicy.retentionDays})
        ORDER BY updated_at
        LIMIT ${limit})`;
  }
}
