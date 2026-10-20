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

export type ProgramSnapshot = ProgramTarget &
  Readonly<{
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
