// The media module's public capability surface. Modules that reference
// media (programming, publications, compositions, catalogs) import only
// this file: they register reference guards that protect media from
// deletion and select media for new references through the port.
import type { Prisma } from "../../generated/prisma/client.js";
import type { CompanyAccess } from "../organizations/public.js";
import type { MediaKind, MediaStatus } from "./domain.js";

export { MediaFailure } from "./domain.js";
export { mediaErrors } from "./errors.js";

/** One protected reference to a media item, with the branch it belongs to. */
export type MediaReference = Readonly<{
  /** Stable kind, such as "playlist-draft" or "publication". */
  kind: string;
  /** Branch the referencing resource belongs to; null for company-wide. */
  branchId: string | null;
}>;

/**
 * Lists protected references to a media item. It runs in the deleting or
 * purging transaction after the item row is locked, so it must only read.
 */
export type MediaReferenceGuard = (
  tx: Prisma.TransactionClient,
  companyId: string,
  assetId: string,
) => Promise<readonly MediaReference[]>;

/** What a new reference may record about a selected media item. */
export type SelectableMedia = Readonly<{
  id: string;
  kind: MediaKind;
  branchId: string | null;
  width: number;
  height: number;
  durationMs: number | null;
  hasAudio: boolean;
  /** Hex SHA-256 of the display rendition, the immutable object to deliver. */
  displaySha256: string;
  displaySize: number;
  displayContentType: string;
}>;

/** What a referencing module may show about an item it already references. */
export type MediaFacts = Readonly<{
  id: string;
  name: string;
  kind: MediaKind;
  status: MediaStatus;
  branchId: string | null;
  durationMs: number | null;
}>;

export type MediaPort = Readonly<{
  /** Registers a guard; deletion and purge ask every registered guard. */
  registerReferenceGuard(kind: string, guard: MediaReferenceGuard): void;
  /**
   * In the caller's transaction, after its organization locks: share-locks
   * the named items and returns them when each is READY and visible to the
   * access, so archiving or deleting waits for the referencing commit.
   * Throws MediaFailure RESOURCE_NOT_FOUND for a hidden or unknown item and
   * MEDIA_NOT_READY for one that is not selectable.
   */
  requireSelectable(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    assetIds: readonly string[],
  ): Promise<SelectableMedia[]>;
  /**
   * Facts about items of one company that the caller already references.
   * It authorizes nothing; unknown IDs are omitted.
   */
  describe(
    companyId: string,
    assetIds: readonly string[],
  ): Promise<MediaFacts[]>;
}>;
