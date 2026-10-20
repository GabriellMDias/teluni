// Framework-independent publication rules from the publication and
// synchronization design (docs/project/publication-sync-design.md,
// ADR-0030): the manifests of protocol 1 and, for programs with a layout,
// protocol 2 (docs/project/catalog-composition-design.md), their content
// digests, publication problems, what a statement authorizes and how fresh
// a screen's contact is.
import { createHash } from "node:crypto";

/** Engineering defaults; changing one is a reviewed code change. */
export const publicationPolicy = Object.freeze({
  /** Protocols this server can serialize, newest first. */
  protocols: [2, 1] as readonly number[],
  syncIntervalSeconds: 30,
  /** AT-24: without recent contact after 90 s, offline after 120 s. */
  staleAfterSeconds: 90,
  offlineAfterSeconds: 120,
  maxItems: 2_000,
  maxMedia: 1_000,
  /** Catalog records a protocol 2 publication carries, over all views. */
  maxRecords: 10_000,
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

/** A rule rebuilt in the fixtures' key order. */
const canonicalRule = (rule: ManifestRule): ManifestRule => ({
  id: rule.id,
  playlistId: rule.playlistId,
  weekdays: [...rule.weekdays],
  allDay: rule.allDay,
  ...(rule.allDay ? {} : { startTime: rule.startTime, endTime: rule.endTime }),
  startsOn: rule.startsOn,
  endsOn: rule.endsOn,
});

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
      rules: output.rules.map(canonicalRule),
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

// Protocol 2: programs with a layout

/** A record on a view page, under its group (choice ID or weekday). */
export type ManifestPageEntry = Readonly<{
  recordId: string;
  group: string | null;
}>;

export type ManifestView = Readonly<{
  catalogId: string;
  fields: readonly Readonly<{ fieldId: string; role: string }>[];
  presentation: string;
  textSize: number;
  unavailable: "hide" | "show";
  pageSeconds: number;
  /** The records of each page, paginated at publication. */
  pages: readonly (readonly ManifestPageEntry[])[];
  /** The records of each group a layout page names, which fit one page. */
  groups: readonly Readonly<{ group: string; recordIds: readonly string[] }>[];
}>;

export type ManifestArea = Readonly<{
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
  view: ManifestView | null;
}>;

export type ManifestLayout = Readonly<{
  orientation: "landscape" | "portrait";
  width: number;
  height: number;
  audioMixConfirmed: boolean;
  areas: readonly ManifestArea[];
  pages: readonly Readonly<{
    durationSeconds: number;
    contents: readonly Readonly<{
      areaKey: string;
      mediaId: string | null;
      viewPage: number | null;
      groupChoiceId: string | null;
    }>[];
  }>[];
}>;

/** An area output: a playlist default, the catalog view, or none. */
export type ManifestAreaOutput = Readonly<{
  key: string;
  default: Readonly<{ playlistId: string }> | Readonly<{ view: true }> | null;
  rules: readonly ManifestRule[];
}>;

export type ManifestCatalogField = Readonly<{
  id: string;
  type: string;
  label: string;
  /** Money fields. */
  currency?: string;
  /** Number fields. */
  decimals?: number;
  /** Selection fields, in display order. */
  choices?: readonly Readonly<{ id: string; label: string }>[];
}>;

export type ManifestCatalog = Readonly<{
  id: string;
  /** Only the fields a view binds. */
  fields: readonly ManifestCatalogField[];
  /**
   * Every record in catalog order, with the values of bound fields other
   * than money; a reference value is the referenced item's title.
   */
  records: readonly Readonly<{
    id: string;
    available: boolean;
    values: Readonly<Record<string, unknown>>;
  }>[];
  /** Per record and money field, limited to the branches the program reaches. */
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

/** What a protocol 2 publication shows: the part its digest covers. */
export type LayoutPublicationContent = Readonly<{
  layout: ManifestLayout;
  outputs: readonly ManifestAreaOutput[];
  catalogs: readonly ManifestCatalog[];
  playlists: readonly ManifestPlaylist[];
  media: readonly ManifestMedia[];
}>;

const byKey = <T>(items: readonly T[], key: (item: T) => string) =>
  [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/**
 * Protocol 2 content in canonical order and key order: areas and outputs in
 * stacking order as given, pages and records as given, catalogs, prices,
 * overrides and promotions by identifier, playlists and media as in
 * protocol 1.
 */
export function canonicalLayoutContent(
  content: LayoutPublicationContent,
): LayoutPublicationContent {
  const shared = canonicalContent({
    outputs: [],
    playlists: content.playlists,
    media: content.media,
  });
  return {
    layout: {
      orientation: content.layout.orientation,
      width: content.layout.width,
      height: content.layout.height,
      audioMixConfirmed: content.layout.audioMixConfirmed,
      areas: content.layout.areas.map((area) => ({
        key: area.key,
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        z: area.z,
        background: area.background,
        fit: area.fit,
        muted: area.muted,
        volume: area.volume,
        kind: area.kind,
        pageControlled: area.pageControlled,
        view: area.view
          ? {
              catalogId: area.view.catalogId,
              fields: area.view.fields.map((field) => ({
                fieldId: field.fieldId,
                role: field.role,
              })),
              presentation: area.view.presentation,
              textSize: area.view.textSize,
              unavailable: area.view.unavailable,
              pageSeconds: area.view.pageSeconds,
              pages: area.view.pages.map((page) =>
                page.map((entry) => ({
                  recordId: entry.recordId,
                  group: entry.group,
                })),
              ),
              groups: byKey(area.view.groups, (entry) => entry.group).map(
                (entry) => ({
                  group: entry.group,
                  recordIds: [...entry.recordIds],
                }),
              ),
            }
          : null,
      })),
      pages: content.layout.pages.map((page) => ({
        durationSeconds: page.durationSeconds,
        contents: page.contents.map((entry) => ({
          areaKey: entry.areaKey,
          mediaId: entry.mediaId,
          viewPage: entry.viewPage,
          groupChoiceId: entry.groupChoiceId,
        })),
      })),
    },
    outputs: content.outputs.map((output) => ({
      key: output.key,
      default:
        output.default === null
          ? null
          : "view" in output.default
            ? { view: true }
            : { playlistId: output.default.playlistId },
      rules: output.rules.map(canonicalRule),
    })),
    catalogs: byId(content.catalogs).map((catalog) => ({
      id: catalog.id,
      fields: catalog.fields.map((field) => ({
        id: field.id,
        type: field.type,
        label: field.label,
        ...(field.currency !== undefined ? { currency: field.currency } : {}),
        ...(field.decimals !== undefined ? { decimals: field.decimals } : {}),
        ...(field.choices !== undefined
          ? {
              choices: field.choices.map((choice) => ({
                id: choice.id,
                label: choice.label,
              })),
            }
          : {}),
      })),
      records: catalog.records.map((record) => ({
        id: record.id,
        available: record.available,
        values: Object.fromEntries(
          catalog.fields.flatMap((field) =>
            field.id in record.values
              ? [[field.id, record.values[field.id]]]
              : [],
          ),
        ),
      })),
      prices: byKey(
        catalog.prices,
        (price) => `${price.recordId}:${price.fieldId}`,
      ).map((price) => ({
        recordId: price.recordId,
        fieldId: price.fieldId,
        base: price.base,
        overrides: byKey(price.overrides, (entry) => entry.branchId).map(
          (entry) => ({ branchId: entry.branchId, amount: entry.amount }),
        ),
        promotions: byId(price.promotions).map((promotion) => ({
          id: promotion.id,
          branchId: promotion.branchId,
          amount: promotion.amount,
          startsAt: promotion.startsAt,
          endsAt: promotion.endsAt,
        })),
      })),
    })),
    playlists: shared.playlists,
    media: shared.media,
  };
}

/** SHA-256 of the canonical protocol 2 content. */
export function layoutContentDigest(content: LayoutPublicationContent): Buffer {
  return sha256(JSON.stringify(canonicalLayoutContent(content)));
}

/** The exact bytes of a protocol 2 manifest and their SHA-256. */
export function layoutManifestBytes(
  header: ManifestHeader,
  content: LayoutPublicationContent,
): { bytes: Buffer; sha256: Buffer } {
  const canonical = canonicalLayoutContent(content);
  const bytes = Buffer.from(
    JSON.stringify({
      format: "teluni.publication",
      protocol: 2,
      publicationId: header.publicationId,
      companyId: header.companyId,
      programId: header.programId,
      generation: header.generation,
      publishedAt: header.publishedAt.toISOString(),
      layout: canonical.layout,
      outputs: canonical.outputs,
      catalogs: canonical.catalogs,
      playlists: canonical.playlists,
      media: canonical.media,
    }),
    "utf8",
  );
  return { bytes, sha256: sha256(bytes) };
}

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
    | "LAYOUT_OUT_OF_SCOPE"
    | "CATALOG_UNAVAILABLE"
    | "CATALOG_FIELD_UNAVAILABLE"
    | "CATALOG_OVERFLOW"
    | "CATALOG_PAGE_MISSING"
    | "CATALOG_GROUP_OVERFLOW";
  playlistId?: string;
  mediaId?: string;
  /** The layout area a catalog problem concerns. */
  areaKey?: string;
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
