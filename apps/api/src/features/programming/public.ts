// The programming module's public capability surface. The publications
// module imports only this file: it snapshots the program a person publishes
// and asks which program a screen follows, and it tells assignments whether
// a destination has been published.
import type { Prisma } from "../../generated/prisma/client.js";
import type { Capability, CompanyAccess } from "../organizations/public.js";

export { ProgrammingFailure } from "./domain.js";
export { programmingErrors } from "./errors.js";
export { zoneOffsets, type ZoneOffsets } from "./schedule.js";

/** A group's program or a screen's own program. */
export type ProgramSource =
  | Readonly<{ kind: "group"; groupId: string }>
  | Readonly<{ kind: "device"; deviceId: string }>;

/** A rule in the representation of the shared schedule fixtures. */
export type PublishableRule = Readonly<{
  /** Stable within its output: `r` and the rule's position from 1. */
  id: string;
  playlistId: string;
  weekdays: readonly number[];
  allDay: boolean;
  /** Local `HH:MM`; absent for an all-day rule. */
  startTime?: string;
  endTime?: string;
  startsOn: string;
  endsOn: string | null;
}>;

/** A program the caller may act on, locked in the caller's transaction. */
export type ProgramTarget = Readonly<{
  /** Null while the source has never been programmed. */
  programId: string | null;
  programVersion: number;
  /** Branches the program reaches; "all" for a whole-company group. */
  reach: "all" | readonly string[];
  /** Branches the program concerns (a group's explicit span or the screen's). */
  branchIds: readonly string[];
}>;

/** A record on a view page, under its group (choice ID or weekday). */
export type SnapshotPageEntry = Readonly<{
  recordId: string;
  group: string | null;
}>;

/** A catalog as a publication carries it: bound fields, records, prices. */
export type CatalogSnapshot = Readonly<{
  id: string;
  fields: readonly Readonly<{
    id: string;
    type: string;
    label: string;
    currency?: string;
    choices?: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  /** Every record in catalog order, with bound non-money values. */
  records: readonly Readonly<{
    id: string;
    available: boolean;
    values: Readonly<Record<string, unknown>>;
  }>[];
  /** Base, branch and promotion prices for the branches reached. */
  prices: readonly Readonly<{
    recordId: string;
    fieldId: string;
    base: number | null;
    overrides: readonly Readonly<{ branchId: string; amount: number }>[];
    promotions: readonly Readonly<{
      id: string;
      branchId: string | null;
      amount: number;
      startsAt: string;
      endsAt: string;
    }>[];
  }>[];
}>;

export type LayoutSnapshotProblem = Readonly<{
  code:
    | "CATALOG_UNAVAILABLE"
    | "CATALOG_FIELD_UNAVAILABLE"
    | "CATALOG_OVERFLOW"
    | "CATALOG_PAGE_MISSING"
    | "CATALOG_GROUP_OVERFLOW";
  areaKey: string;
}>;

/**
 * A program's layout as a publication carries it: the canvas, areas with
 * their views paginated now, pages, the catalogs the views use and the
 * media its pages and catalog values name.
 */
export type LayoutSnapshot = Readonly<{
  id: string;
  /** Whether the layout covers every branch the program reaches. */
  usable: boolean;
  orientation: "landscape" | "portrait";
  width: number;
  height: number;
  audioMixConfirmed: boolean;
  areas: readonly Readonly<{
    key: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
    background: string;
    fit: "contain" | "cover";
    muted: boolean;
    volume: number;
    kind: "media" | "catalog";
    pageControlled: boolean;
    view: Readonly<{
      catalogId: string;
      fields: readonly Readonly<{ fieldId: string; role: string }>[];
      presentation: string;
      textSize: number;
      unavailable: "hide" | "show";
      pageSeconds: number;
      pages: readonly (readonly SnapshotPageEntry[])[];
      groups: readonly Readonly<{
        group: string;
        recordIds: readonly string[];
      }>[];
    }> | null;
  }>[];
  pages: readonly Readonly<{
    durationSeconds: number;
    contents: readonly Readonly<{
      areaKey: string;
      mediaId: string | null;
      viewPage: number | null;
      groupChoiceId: string | null;
    }>[];
  }>[];
  catalogs: readonly CatalogSnapshot[];
  mediaIds: readonly string[];
  problems: readonly LayoutSnapshotProblem[];
}>;

export type ProgramSnapshot = ProgramTarget &
  Readonly<{
    /**
     * The program's layout; its outputs are then the layout's areas, which
     * only protocol 2 publishes.
     */
    layoutId: string | null;
    layout: LayoutSnapshot | null;
    outputs: readonly Readonly<{
      key: string;
      defaultPlaylistId: string | null;
      rules: readonly PublishableRule[];
      /** False when the stored rules no longer pass validation. */
      valid: boolean;
    }>[];
    /** Every playlist the outputs reference, share-locked. */
    playlists: readonly Readonly<{
      id: string;
      branchId: string | null;
      transition: "CUT" | "FADE";
      fadeMs: number | null;
      /** Whether the playlist fits every branch the program reaches. */
      usable: boolean;
      items: readonly Readonly<{
        mediaAssetId: string;
        durationMs: number | null;
      }>[];
    }>[];
  }>;

/**
 * Whether a program has a publication; assignments ask it inside their
 * transaction to decide whether the person must confirm neutral output.
 */
export type PublicationFacts = (
  tx: Prisma.TransactionClient,
  companyId: string,
  programId: string,
) => Promise<boolean>;

export type ProgrammingPort = Readonly<{
  /** Registers the publication facts; register before activation. */
  onPublicationFacts(facts: PublicationFacts): void;
  /**
   * After the caller's organization locks: share-locks the source (group
   * or screen) and its program, checks that the access sees the source and
   * holds the capability over everything the program reaches, and returns
   * the target. Without a transaction nothing is locked. Throws
   * RESOURCE_NOT_FOUND for a hidden or unknown source.
   */
  target(
    tx: Prisma.TransactionClient | null,
    access: CompanyAccess,
    source: ProgramSource,
    capability: Capability,
  ): Promise<ProgramTarget>;
  /**
   * As `target`, in a transaction, and also share-locks the referenced
   * playlists and returns the program's content.
   */
  snapshot(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    source: ProgramSource,
    capability: Capability,
  ): Promise<ProgramSnapshot>;
  /** The program a screen follows now, by its settings; authorizes nothing. */
  currentProgram(
    companyId: string,
    deviceId: string,
  ): Promise<
    Readonly<{ source: "group" | "individual"; programId: string | null }>
  >;
  /** Screens that follow a source's program now; authorizes nothing. */
  followers(companyId: string, source: ProgramSource): Promise<string[]>;
}>;
