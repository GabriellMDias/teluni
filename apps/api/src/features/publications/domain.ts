// Framework-independent publication rules from the publication and
// synchronization design (docs/project/publication-sync-design.md,
// ADR-0030): the manifest of protocol 1, its content digest, publication
// problems, what a statement authorizes and how fresh a screen's contact is.
import { createHash } from "node:crypto";

/** Engineering defaults; changing one is a reviewed code change. */
export const publicationPolicy = Object.freeze({
  /** Protocols this server can serialize, newest first. */
  protocols: [1] as readonly number[],
  syncIntervalSeconds: 30,
  /** AT-24: without recent contact after 90 s, offline after 120 s. */
  staleAfterSeconds: 90,
  offlineAfterSeconds: 120,
  maxItems: 2_000,
  maxMedia: 1_000,
  maxPerProgramPerHour: 30,
  maxPerCompanyPerDay: 300,
  /** AT-18: superseded publications stay restorable this long. */
  retentionDays: 90,
  /** A screen's report protects what it uses for this long. */
  reportedInUseDays: 7,
  /** AT-20: report transitions are kept this long. */
  eventRetentionDays: 30,
  maxConcurrentDownloads: 2,
  maxStateQuery: 100,
  /** Zone offsets a sync answer covers around its server time (D-07). */
  zoneOffsetsBeforeDays: 3,
  zoneOffsetsAfterDays: 35,
});

export type PublicationFailureCode =
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RESOURCE_VERSION_CONFLICT"
  | "RATE_LIMITED"
  | "PUBLICATION_INVALID"
  | "PUBLICATION_NOT_RESTORABLE"
  | "PROTOCOL_UNSUPPORTED";

export class PublicationFailure extends Error {
  readonly code: PublicationFailureCode;
  constructor(code: PublicationFailureCode) {
    super(`Publication failure: ${code}`);
    this.name = "PublicationFailure";
    this.code = code;
  }
}

/** A rule as the shared schedule fixtures represent it. */
export type ManifestRule = Readonly<{
  id: string;
  playlistId: string;
  weekdays: readonly number[];
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  startsOn: string;
  endsOn: string | null;
}>;

export type ManifestOutput = Readonly<{
  key: string;
  defaultPlaylistId: string | null;
  rules: readonly ManifestRule[];
}>;

export type ManifestTransition =
  Readonly<{ kind: "CUT" }> | Readonly<{ kind: "FADE"; durationMs: number }>;

export type ManifestPlaylist = Readonly<{
  id: string;
  transition: ManifestTransition;
  items: readonly Readonly<{ mediaId: string; durationMs: number | null }>[];
}>;

export type ManifestMedia = Readonly<{
  id: string;
  kind: "IMAGE" | "VIDEO";
  contentType: string;
  size: number;
  sha256: string;
  width: number;
  height: number;
  durationMs: number | null;
  hasAudio: boolean;
}>;

/** What a publication shows: the part its content digest covers. */
export type PublicationContent = Readonly<{
  outputs: readonly ManifestOutput[];
  playlists: readonly ManifestPlaylist[];
  media: readonly ManifestMedia[];
}>;

const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * The content in canonical order and key order: outputs as given, rules in
 * position order, playlists and media by ID, items in playlist order. Each
 * object is rebuilt so its keys follow the protocol's fixed order.
 */
export function canonicalContent(
  content: PublicationContent,
): PublicationContent {
  return {
    outputs: content.outputs.map((output) => ({
      key: output.key,
      defaultPlaylistId: output.defaultPlaylistId,
      rules: output.rules.map((rule) => ({
        id: rule.id,
        playlistId: rule.playlistId,
        weekdays: [...rule.weekdays],
        allDay: rule.allDay,
        ...(rule.allDay
          ? {}
          : { startTime: rule.startTime, endTime: rule.endTime }),
        startsOn: rule.startsOn,
        endsOn: rule.endsOn,
      })),
    })),
    playlists: byId(content.playlists).map((playlist) => ({
      id: playlist.id,
      transition:
        playlist.transition.kind === "FADE"
          ? { kind: "FADE", durationMs: playlist.transition.durationMs }
          : { kind: "CUT" },
      items: playlist.items.map((item) => ({
        mediaId: item.mediaId,
        durationMs: item.durationMs,
      })),
    })),
    media: byId(content.media).map((item) => ({
      id: item.id,
      kind: item.kind,
      contentType: item.contentType,
      size: item.size,
      sha256: item.sha256,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
      hasAudio: item.hasAudio,
    })),
  };
}

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest();

/**
 * SHA-256 of the canonical content: equal for equal content whatever the
 * generation, time or identifiers of the publication that holds it.
 */
export function contentDigest(content: PublicationContent): Buffer {
  return sha256(JSON.stringify(canonicalContent(content)));
}

export type ManifestHeader = Readonly<{
  publicationId: string;
  companyId: string;
  programId: string;
  generation: number;
  publishedAt: Date;
}>;

/** The exact bytes of a protocol 1 manifest and their SHA-256. */
export function manifestBytes(
  header: ManifestHeader,
  content: PublicationContent,
): { bytes: Buffer; sha256: Buffer } {
  const canonical = canonicalContent(content);
  const bytes = Buffer.from(
    JSON.stringify({
      format: "teluni.publication",
      protocol: 1,
      publicationId: header.publicationId,
      companyId: header.companyId,
      programId: header.programId,
      generation: header.generation,
      publishedAt: header.publishedAt.toISOString(),
      outputs: canonical.outputs,
      playlists: canonical.playlists,
      media: canonical.media,
    }),
    "utf8",
  );
  return { bytes, sha256: sha256(bytes) };
}

/** Why a program cannot be published as it is. */
export type PublicationProblem = Readonly<{
  code:
    | "NOTHING_TO_PUBLISH"
    | "SCHEDULE_INVALID"
    | "PLAYLIST_OUT_OF_SCOPE"
    | "MEDIA_UNAVAILABLE"
    | "TRANSITION_UNSUPPORTED"
    | "TOO_LARGE"
    | "LAYOUT_NOT_PUBLISHABLE";
  playlistId?: string;
  mediaId?: string;
}>;

/** The highest protocol both sides support, or none. */
export function agreedProtocol(supported: readonly number[]): number | null {
  return (
    publicationPolicy.protocols.find((protocol) =>
      supported.includes(protocol),
    ) ?? null
  );
}

export type AuthorizedPublication = Readonly<{ id: string; sha256: string }>;

/**
 * What a statement authorizes: the desired publication and, while the
 * screen has not activated it, the active and recovery generations it
 * reported (already resolved to unpruned publications of its company). Once
 * the desired one is active, superseded generations get no new authority.
 * An unpublished source authorizes nothing, so the screen shows neutral
 * output.
 */
export function authorizedPublications(
  desired: AuthorizedPublication | null,
  activeId: string | null,
  reported: readonly AuthorizedPublication[],
): AuthorizedPublication[] {
  if (!desired) return [];
  if (activeId === desired.id) return [desired];
  const list = [desired];
  for (const item of reported)
    if (!list.some((known) => known.id === item.id)) list.push(item);
  return list;
}

export type Connection = "online" | "stale" | "offline" | "never";

/** AT-24 from the last sync the server received. */
export function connection(lastContact: Date | null, now: Date): Connection {
  if (!lastContact) return "never";
  const seconds = (now.getTime() - lastContact.getTime()) / 1000;
  if (seconds <= publicationPolicy.staleAfterSeconds) return "online";
  if (seconds <= publicationPolicy.offlineAfterSeconds) return "stale";
  return "offline";
}
