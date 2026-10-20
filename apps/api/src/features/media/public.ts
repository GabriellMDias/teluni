// The media module's public capability surface. Modules that reference
// media (programming, publications, compositions, catalogs) import only
// this file: they register reference guards that protect media from
// deletion, select media for new references through the port, and
// publications stream the renditions they copied.
import type { Readable } from "node:stream";
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

/**
 * What a publication may record about a media item it is about to copy:
 * the item's state and, while it has one, its display rendition.
 */
export type PublishableMedia = Readonly<{
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  branchId: string | null;
  width: number;
  height: number;
  durationMs: number | null;
  hasAudio: boolean;
  display: Readonly<{
    /** Hex SHA-256 of the rendition, the immutable object to deliver. */
    sha256: string;
    size: number;
    contentType: string;
  }> | null;
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
  /**
   * In the caller's transaction: share-locks the named items of one company
   * and describes them for a publication, whatever their state, so a
   * concurrent deletion waits for the publication to commit. Unknown IDs
   * are omitted. It authorizes nothing; the caller decides what to copy.
   */
  describeForPublication(
    tx: Prisma.TransactionClient,
    companyId: string,
    assetIds: readonly string[],
  ): Promise<PublishableMedia[]>;
  /**
   * Streams one stored object of a company by its hex SHA-256, optionally a
   * byte range. It authorizes nothing: callers deliver only objects their
   * own records name, which reference guards keep stored.
   */
  openObject(
    companyId: string,
    sha256: string,
    range?: Readonly<{ start: number; end: number }>,
  ): Readable;
}>;
