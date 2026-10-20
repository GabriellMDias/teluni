// The catalogs module's public capability surface. Modules that bind
// catalogs (programming's layouts, later publications) import only this
// file: they register usage guards that protect bound catalogs and fields,
// check catalogs before binding them, and read what a view shows.
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

/** Everything a view of a catalog shows, in the catalog's stored order. */
export type CatalogViewData = Readonly<{
  catalog: BindableCatalog;
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
   * In the caller's transaction, after its organization locks: key-share
   * locks the named catalogs, so their deletion waits for the binding
   * commit, and returns those that are active and visible to the access.
   */
  requireBindable(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    catalogIds: readonly string[],
  ): Promise<BindableCatalog[]>;
  /** Catalogs of one company the caller already binds; authorizes nothing. */
  describe(
    companyId: string,
    catalogIds: readonly string[],
  ): Promise<BindableCatalog[]>;
  /** What a view of one catalog shows; authorizes nothing. */
  viewData(
    companyId: string,
    catalogId: string,
  ): Promise<CatalogViewData | null>;
}>;
