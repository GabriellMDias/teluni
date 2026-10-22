// The catalogs module's public capability surface. Modules that bind
// catalogs (programming's layouts, publications) import only this file:
// they register usage guards that protect bound catalogs and fields, check
// catalogs before binding them, read what a view shows, and hear of price
// changes inside their transaction.
import type { Prisma } from "../../generated/prisma/client.js";
import type { CompanyAccess } from "../organizations/public.js";
import type { FieldType, Promotion, Values } from "./domain.js";

export { CatalogFailure } from "./domain.js";
export { catalogErrors } from "./errors.js";
export type { FieldType } from "./domain.js";

/** How many layouts use a catalog and each of its fields. */
export type CatalogUsage = Readonly<{
  layouts: number;
  fields: ReadonlyMap<string, number>;
}>;

/**
 * Counts what binds a catalog. It runs in the deleting or schema-saving
 * transaction after the catalog row is locked, so it must only read.
 */
export type CatalogUsageGuard = (
  tx: Prisma.TransactionClient,
  companyId: string,
  catalogId: string,
) => Promise<CatalogUsage>;

export type BindableField = Readonly<{
  id: string;
  label: string;
  type: FieldType;
  archived: boolean;
  choices: readonly Readonly<{ id: string; label: string }>[];
  currency: string | null;
}>;

export type BindableCatalog = Readonly<{
  id: string;
  name: string;
  branchId: string | null;
  status: "ACTIVE" | "ARCHIVED";
  fields: readonly BindableField[];
}>;

/**
 * Runs in a price change's transaction, after the change and its count:
 * the publications module queues the change for the programs that show the
 * catalog. Answers false when the author may not publish one of them; the
 * change is then refused with PRICE_TARGET_FORBIDDEN. It must only read and
 * queue, through the transaction.
 */
export type PriceChangeListener = (
  tx: Prisma.TransactionClient,
  change: Readonly<{
    access: CompanyAccess;
    catalogId: string;
    /**
     * The branch whose price changed (a branch price or branch promotion),
     * or null for a change of the whole scope (base price or scope-wide
     * promotion).
     */
    branchId: string | null;
    /** The change's number in the catalog's commit-ordered price sequence. */
    sequence: number;
  }>,
) => Promise<boolean>;

/** Everything a view of a catalog shows, in the catalog's stored order. */
export type CatalogViewData = Readonly<{
  catalog: BindableCatalog;
  /** The latest price change these prices include (0 before any). */
  priceSequence: number;
  records: readonly Readonly<{
    id: string;
    available: boolean;
    values: Values;
  }>[];
  /** Base price, branch prices and promotions per record and money field. */
  prices: ReadonlyMap<
    string,
    ReadonlyMap<
      string,
      Readonly<{
        base: number | null;
        overrides: ReadonlyMap<string, number>;
        promotions: readonly Promotion[];
      }>
    >
  >;
  /** Titles of the records that reference values name. */
  referenceTitles: ReadonlyMap<string, string | null>;
}>;

export type CatalogPort = Readonly<{
  /** Registers a guard; deletion and schema saves ask every registered guard. */
  registerUsageGuard(guard: CatalogUsageGuard): void;
  /**
   * Registers a listener that every price change runs; register before
   * activation. It runs even while the registering module is unmounted.
   */
  onPriceChange(listener: PriceChangeListener): void;
  /**
   * In the caller's transaction, after its organization locks: key-share
   * locks the named catalogs, so their deletion waits for the binding
   * commit, and returns those that are active and visible to the access.
   */
  requireBindable(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    catalogIds: readonly string[],
  ): Promise<BindableCatalog[]>;
  /** A catalog the access may view (`catalogs.view` on its scope), or null. */
  visible(
    access: CompanyAccess,
    catalogId: string,
  ): Promise<BindableCatalog | null>;
  /** Catalogs of one company the caller already binds; authorizes nothing. */
  describe(
    companyId: string,
    catalogIds: readonly string[],
  ): Promise<BindableCatalog[]>;
  /**
   * The latest committed price change of each named catalog (0 before
   * any), read through the caller's transaction; authorizes nothing.
   */
  priceSequences(
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  /**
   * What a view of one catalog shows, read in one snapshot with the price
   * sequence it includes; authorizes nothing.
   */
  viewData(
    companyId: string,
    catalogId: string,
  ): Promise<CatalogViewData | null>;
}>;
