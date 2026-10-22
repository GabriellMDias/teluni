import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { Prisma } from "../../generated/prisma/client.js";
import type { CatalogPort } from "../catalogs/public.js";
import { DeviceFailure, type DevicePort } from "../devices/public.js";
import type { HumanContext } from "../identity/public.js";
import type { MediaPort, PublishableMedia } from "../media/public.js";
import {
  decide,
  OrganizationFailure,
  type CompanyAccess,
  type CompanyAccessPort,
} from "../organizations/public.js";
import {
  ProgrammingFailure,
  zoneOffsets,
  type ProgramSnapshot,
  type ProgramSource,
  type ProgramTarget,
  type ProgrammingPort,
  type ZoneOffsets,
} from "../programming/public.js";
import {
  agreedProtocol,
  authorizedPublications,
  canonicalContent,
  canonicalLayoutContent,
  connection,
  contentDigest,
  layoutContentDigest,
  layoutManifestBytes,
  manifestBytes,
  priceIntentPolicy,
  priceRetryDelayMs,
  publicationPolicy,
  PublicationFailure,
  type AuthorizedPublication,
  type Connection,
  type LayoutPublicationContent,
  type ManifestMedia,
  type ManifestPlaylist,
  type PublicationContent,
  type PublicationProblem,
} from "./domain.js";
import {
  queueIntent,
  type ClaimedIntent,
  type IntentOutcome,
  type PriceIntentRecord,
  type PrismaPriceIntentRepository,
} from "./price-repository.js";
import type {
  Actor,
  CatalogCopy,
  DeliveredMedia,
  DeviceEventKind,
  PrismaPublicationRepository,
  PublicationOrigin,
  PublicationRecord,
  StateRecord,
} from "./prisma-repository.js";
import {
  publicKeySet,
  signStatement,
  type PublicKeySet,
  type SigningKey,
} from "./statements.js";

export type PublicationView = PublicationRecord &
  Readonly<{
    state: "current" | "retained" | "pruned";
    isCaller: boolean;
  }>;

/** An intent as a catalog's panel shows it. */
export type PriceIntentView = PriceIntentRecord &
  Readonly<{
    /** The program's group or screen, when the caller may see it. */
    target: Readonly<{
      kind: "group" | "device";
      id: string;
      name: string;
    }> | null;
    authorIsCaller: boolean;
  }>;

export type CheckView = Readonly<{
  problems: readonly PublicationProblem[];
  counts: PublicationRecord["counts"];
  contentDigest: string;
  unchanged: boolean;
  latest: PublicationView | null;
  followers: number;
}>;

export type ScreenStateView = Readonly<{
  deviceId: string;
  connection: Connection;
  lastContactAt: Date | null;
  source: "group" | "individual";
  desired: Readonly<{ publicationId: string; generation: number }> | null;
  publication:
    "up_to_date" | "updating" | "pending" | "failed" | "neutral" | "unknown";
  reported:
    | (StateRecord & {
        activeGeneration: number | null;
        stagingGeneration: number | null;
      })
    | null;
}>;

/** What a screen reports at each synchronization. */
export type SyncReport = Readonly<{
  protocols: readonly number[];
  appVersion: string;
  active: Readonly<{ publicationId: string; activatedAt: string }> | null;
  recovery: Readonly<{ publicationId: string }> | null;
  staging: Readonly<{
    publicationId: string;
    state: "DOWNLOADING" | "VERIFYING" | "READY" | "FAILED";
    failure: string | null;
    bytesDone: number;
    bytesTotal: number;
  }> | null;
  playback: string;
  storage: Readonly<{ freeBytes: number; totalBytes: number }> | null;
  deviceTime: string | null;
}>;

export type SyncAnswer = Readonly<{
  protocol: number;
  serverTime: Date;
  status: "active" | "suspended" | "unlinked";
  clearRequired: boolean;
  timeZone: string | null;
  /** The zone's UTC offsets around `serverTime`; null without a zone. */
  zoneOffsets: ZoneOffsets | null;
  rotation: 0 | 90 | 180 | 270 | null;
  /** The screen's branch, for branch prices of protocol 2 catalogs. */
  branchId: string | null;
  desired: Readonly<{
    publicationId: string;
    generation: number;
    protocol: number;
    manifestSha256: string;
    manifestSize: number;
    source: "group" | "individual";
  }> | null;
  authorization: string | null;
  nextSyncSeconds: number;
}>;

/**
 * What a publication serializes: protocol 1 for programs without a layout,
 * byte for byte as before, and protocol 2 for programs with one.
 */
type Payload =
  | Readonly<{ protocol: 1; content: PublicationContent }>
  | Readonly<{ protocol: 2; content: LayoutPublicationContent }>;

const digestOf = (payload: Payload) =>
  payload.protocol === 2
    ? layoutContentDigest(payload.content)
    : contentDigest(payload.content);

type Built = Readonly<{
  target: ProgramTarget;
  payload: Payload;
  playlists: readonly Readonly<{ id: string; branchId: string | null }>[];
  problems: PublicationProblem[];
  counts: PublicationRecord["counts"];
  digest: Buffer;
  catalogs: readonly CatalogCopy[];
}>;

/** The claim on an intent was lost while it was being processed. */
class ClaimLost extends Error {}

const publish = "publications.publish";
const dayMs = 86_400_000;

const encodeCursor = (generation: number) =>
  Buffer.from(JSON.stringify({ g: generation }), "utf8").toString("base64url");

function decodeCursor(cursor: string): number {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const generation =
      parsed && typeof parsed === "object" && "g" in parsed
        ? parsed.g
        : undefined;
    if (
      typeof generation === "number" &&
      Number.isSafeInteger(generation) &&
      generation >= 1
    )
      return generation;
  } catch {
    // Malformed cursors answer like invalid ones.
  }
  throw new PublicationFailure("VALIDATION_FAILED");
}

const actorOf = (context: HumanContext, access: CompanyAccess): Actor => ({
  principalId: context.principalId,
  membershipId: access.membershipId,
});

/**
 * Whether a program's reach stays inside the branches an earlier
 * publication concerned: none recorded means the whole company.
 */
function withinReach(
  reach: ProgramTarget["reach"],
  earlier: readonly string[],
): boolean {
  if (earlier.length === 0) return true;
  return (
    reach !== "all" && reach.every((branchId) => earlier.includes(branchId))
  );
}

/** Whether a playlist owned by `branchId` fits every branch of the reach. */
function fits(branchId: string | null, reach: ProgramTarget["reach"]): boolean {
  return (
    branchId === null ||
    (reach !== "all" && reach.length === 1 && reach[0] === branchId)
  );
}

/** Publications over the organizations, devices, media and programming ports. */
export class PublicationService {
  readonly #repository: PrismaPublicationRepository;
  readonly #companies: CompanyAccessPort;
  readonly #devices: DevicePort;
  readonly #media: MediaPort;
  readonly #programming: ProgrammingPort;
  readonly #catalogs: CatalogPort;
  readonly #intents: PrismaPriceIntentRepository;
  readonly #keys: readonly SigningKey[];
  #keySet: Promise<PublicKeySet> | undefined;
  readonly #downloads = new Map<string, number>();

  constructor(options: {
    repository: PrismaPublicationRepository;
    companies: CompanyAccessPort;
    devices: DevicePort;
    media: MediaPort;
    programming: ProgrammingPort;
    catalogs: CatalogPort;
    intents: PrismaPriceIntentRepository;
    keys: readonly SigningKey[];
  }) {
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#devices = options.devices;
    this.#media = options.media;
    this.#programming = options.programming;
    this.#catalogs = options.catalogs;
    this.#intents = options.intents;
    this.#keys = options.keys;
  }

  // Publishing

  async list(
    context: HumanContext,
    companyId: string,
    source: ProgramSource,
    query: { limit: number; cursor?: string },
  ): Promise<{ items: PublicationView[]; nextCursor: string | null }> {
    const access = await this.#companies.resolve(context, companyId);
    const target = await this.#programming.target(
      null,
      access,
      source,
      "programming.view",
    );
    if (!target.programId) return { items: [], nextCursor: null };
    const before = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.#repository.list(companyId, target.programId, {
      limit: query.limit + 1,
      ...(before === undefined ? {} : { beforeGeneration: before }),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => this.#view(row, access)),
      nextCursor:
        rows.length > query.limit
          ? encodeCursor(page[page.length - 1].generation)
          : null,
    };
  }

  async check(
    context: HumanContext,
    companyId: string,
    source: ProgramSource,
  ): Promise<CheckView> {
    const result = await this.#withLocks(
      context,
      companyId,
      source,
      async (tx, access) => {
        const built = await this.#build(tx, access, source);
        const latest = built.target.programId
          ? await this.#repository.latest(companyId, built.target.programId, tx)
          : null;
        return { built, latest, access };
      },
    );
    const { built, latest, access } = result;
    return {
      problems: built.problems,
      counts: built.counts,
      contentDigest: built.digest.toString("hex"),
      unchanged: latest !== null && latest.contentSha256.equals(built.digest),
      latest: latest ? this.#view(latest, access) : null,
      followers: (await this.#programming.followers(companyId, source)).length,
    };
  }

  async publish(
    context: HumanContext,
    companyId: string,
    source: ProgramSource,
    expectedDigest: string,
  ): Promise<{ publication: PublicationView; created: boolean }> {
    const result = await this.#withLocks(
      context,
      companyId,
      source,
      async (tx, access) => {
        const built = await this.#build(tx, access, source);
        if (built.problems.length > 0)
          throw new PublicationFailure("PUBLICATION_INVALID");
        if (built.digest.toString("hex") !== expectedDigest)
          throw new PublicationFailure("RESOURCE_VERSION_CONFLICT");
        const programId = built.target.programId!;
        return {
          access,
          ...(await this.#record(tx, actorOf(context, access), companyId, {
            programId,
            branchIds: built.target.branchIds,
            payload: built.payload,
            digest: built.digest,
            counts: built.counts,
            playlists: built.playlists,
            restoredFromGeneration: null,
            origin: "MANUAL",
            catalogs: built.catalogs,
          })),
        };
      },
    );
    return {
      publication: this.#view(result.publication, result.access),
      created: result.created,
    };
  }

  async restore(
    context: HumanContext,
    companyId: string,
    source: ProgramSource,
    publicationId: string,
  ): Promise<{ publication: PublicationView; created: boolean }> {
    const result = await this.#withLocks(
      context,
      companyId,
      source,
      async (tx, access) => {
        const target = await this.#programming.target(
          tx,
          access,
          source,
          publish,
        );
        const earlier = await this.#repository.find(
          companyId,
          publicationId,
          tx,
        );
        if (!earlier || earlier.programId !== target.programId)
          throw new PublicationFailure("RESOURCE_NOT_FOUND");
        const manifest = earlier.prunedAt
          ? null
          : await this.#repository.manifest(companyId, publicationId, tx);
        if (!manifest)
          throw new PublicationFailure("PUBLICATION_NOT_RESTORABLE");
        const stored = JSON.parse(manifest.toString("utf8")) as Partial<
          LayoutPublicationContent & PublicationContent
        > & {
          protocol: 1 | 2;
          playlists: ManifestPlaylist[];
          media: ManifestMedia[];
        };
        // Protocol 2 prices and catalogs were limited to the reach of the
        // time: a copy may serve no branch beyond it.
        if (
          stored.protocol === 2 &&
          !withinReach(target.reach, earlier.branchIds)
        )
          throw new PublicationFailure("PUBLICATION_INVALID");
        const playlists = await this.#repository.playlists(
          tx,
          companyId,
          publicationId,
        );
        // The copy keeps its content, but a narrower reach or deleted media
        // must still refuse it.
        if (playlists.some((item) => !fits(item.branchId, target.reach)))
          throw new PublicationFailure("PUBLICATION_INVALID");
        const media = await this.#media.describeForPublication(
          tx,
          companyId,
          stored.media.map((item) => item.id),
        );
        const current = new Map(media.map((item) => [item.id, item]));
        if (
          stored.media.some((item) => {
            const found = current.get(item.id);
            return (
              !found ||
              !publishable(found) ||
              found.display?.sha256 !== item.sha256
            );
          })
        )
          throw new PublicationFailure("PUBLICATION_INVALID");
        const payload: Payload =
          stored.protocol === 2
            ? {
                protocol: 2,
                content: {
                  layout: stored.layout!,
                  outputs:
                    stored.outputs as LayoutPublicationContent["outputs"],
                  catalogs: stored.catalogs!,
                  playlists: stored.playlists,
                  media: stored.media,
                },
              }
            : {
                protocol: 1,
                content: {
                  outputs: stored.outputs as PublicationContent["outputs"],
                  playlists: stored.playlists,
                  media: stored.media,
                },
              };
        return {
          access,
          ...(await this.#record(tx, actorOf(context, access), companyId, {
            programId: earlier.programId,
            branchIds: target.branchIds,
            payload,
            digest: earlier.contentSha256,
            counts: earlier.counts,
            playlists,
            restoredFromGeneration: earlier.generation,
            origin: "RESTORE",
            // The copy's prices are those of its time; the catalogs'
            // current prices follow as price publications.
            catalogs: await this.#repository.catalogs(
              tx,
              companyId,
              earlier.id,
            ),
          })),
        };
      },
    );
    return {
      publication: this.#view(result.publication, result.access),
      created: result.created,
    };
  }

  // Automatic price publication

  /**
   * Turns one claimed intent into its outcome in one transaction: a new
   * generation of the program's latest publication with the catalog's
   * current prices, or why there is none. The intent is finished in the
   * same transaction; a lost claim rolls everything back.
   */
  async publishPrices(intent: ClaimedIntent): Promise<IntentOutcome> {
    try {
      return await this.#repository.transaction(async (tx) => {
        const outcome = await this.#priceOutcome(tx, intent);
        if (!(await this.#intents.finish(tx, intent, outcome)))
          throw new ClaimLost();
        return outcome;
      });
    } catch (error) {
      if (error instanceof ClaimLost)
        return { retryInMs: 0, reason: "CLAIM_LOST" };
      const code =
        error instanceof PublicationFailure ||
        error instanceof ProgrammingFailure ||
        error instanceof OrganizationFailure
          ? error.code
          : null;
      // Another generation came first, or a limit or suspension holds:
      // try again later from the then latest publication.
      if (
        code !== "RATE_LIMITED" &&
        code !== "RESOURCE_VERSION_CONFLICT" &&
        code !== "COMPANY_SUSPENDED"
      )
        throw error;
      const outcome: IntentOutcome = {
        retryInMs:
          code === "RESOURCE_VERSION_CONFLICT"
            ? 1_000
            : priceRetryDelayMs(intent.attempts),
        reason: code,
      };
      await this.#intents.finish(null, intent, outcome);
      return outcome;
    }
  }

  async #priceOutcome(
    tx: Prisma.TransactionClient,
    intent: ClaimedIntent,
  ): Promise<IntentOutcome> {
    const { companyId, programId, catalogId } = intent;
    const gone = (reason: string): IntentOutcome => ({
      state: "SKIPPED",
      reason,
      publicationId: null,
      includes: Number.MAX_SAFE_INTEGER,
    });
    const source = await this.#programming.programSource(companyId, programId);
    const latest = await this.#repository.latest(companyId, programId, tx);
    if (!source || !latest) return gone("NOT_PUBLISHED");
    const copies = await this.#repository.catalogs(tx, companyId, latest.id);
    const copy = copies.find((item) => item.catalogId === catalogId);
    if (!copy) return gone("NOT_PUBLISHED");
    if (copy.priceSequence >= intent.priceSequence)
      return {
        state: "SKIPPED",
        reason: "INCLUDED",
        publicationId: latest.id,
        includes: copy.priceSequence,
      };
    // Authority is checked again now: removed authority blocks the intent
    // until someone who may publish the program authorizes it again.
    const authority =
      intent.authorizedByMembershipId ?? intent.authorMembershipId;
    const locked = await this.#companies.lockForMembership(
      tx,
      companyId,
      authority,
      latest.branchIds,
    );
    if (!locked) return { state: "BLOCKED", reason: "AUTHOR_INACTIVE" };
    let target: ProgramTarget;
    try {
      target = await this.#programming.target(
        tx,
        locked.access,
        source,
        publish,
      );
    } catch (error) {
      const code =
        error instanceof OrganizationFailure ||
        error instanceof ProgrammingFailure
          ? error.code
          : null;
      if (code === "PERMISSION_DENIED" || code === "RESOURCE_NOT_FOUND")
        return { state: "BLOCKED", reason: "AUTHOR_NOT_AUTHORIZED" };
      throw error;
    }
    if (target.programId !== programId) return gone("NOT_PUBLISHED");
    // The copy's prices cover the branches it was published for only.
    if (!withinReach(target.reach, latest.branchIds))
      return { state: "FAILED", reason: "REACH_CHANGED" };
    const manifest = await this.#repository.manifest(companyId, latest.id, tx);
    const stored = manifest
      ? (JSON.parse(
          manifest.toString("utf8"),
        ) as Partial<LayoutPublicationContent> & { protocol: number })
      : null;
    const published = stored?.catalogs?.find((item) => item.id === catalogId);
    if (!stored || stored.protocol !== 2 || !stored.layout || !published)
      return gone("NOT_PUBLISHED");
    const repriced = await this.#programming.repriceCatalog(
      companyId,
      {
        areas: stored.layout.areas,
        pages: stored.layout.pages,
        catalog: published,
      },
      latest.branchIds.length === 0 ? "all" : new Set(latest.branchIds),
    );
    if (!repriced) return gone("CATALOG_DELETED");
    if (repriced.problems.length > 0)
      return { state: "FAILED", reason: repriced.problems[0].code };
    const views = new Map(repriced.views.map((view) => [view.areaKey, view]));
    const content: LayoutPublicationContent = {
      layout: {
        ...stored.layout,
        areas: stored.layout.areas.map((area) => {
          const view = views.get(area.key);
          return view && area.view
            ? { ...area, view: { ...area.view, ...view } }
            : area;
        }),
      },
      outputs: stored.outputs!,
      catalogs: stored.catalogs!.map((item) =>
        item.id === catalogId ? repriced.catalog : item,
      ),
      playlists: stored.playlists!,
      media: stored.media!,
    };
    // The copy keeps its playlists and media, which must still be usable.
    const playlists = await this.#repository.playlists(
      tx,
      companyId,
      latest.id,
    );
    if (playlists.some((item) => !fits(item.branchId, target.reach)))
      return { state: "FAILED", reason: "REACH_CHANGED" };
    const media = new Map(
      (
        await this.#media.describeForPublication(
          tx,
          companyId,
          content.media.map((item) => item.id),
        )
      ).map((item) => [item.id, item]),
    );
    if (
      content.media.some((item) => {
        const found = media.get(item.id);
        return (
          !found || !publishable(found) || found.display?.sha256 !== item.sha256
        );
      })
    )
      return { state: "FAILED", reason: "MEDIA_UNAVAILABLE" };
    const result = await this.#record(
      tx,
      { principalId: locked.access.principalId, membershipId: authority },
      companyId,
      {
        programId,
        branchIds: target.branchIds,
        payload: { protocol: 2, content: canonicalLayoutContent(content) },
        digest: layoutContentDigest(content),
        counts: latest.counts,
        playlists,
        restoredFromGeneration: null,
        origin: "PRICE",
        catalogs: copies.map((item) =>
          item.catalogId === catalogId
            ? { catalogId, priceSequence: repriced.priceSequence }
            : item,
        ),
        price: {
          base: latest.id,
          intent,
          catalogId,
          priceSequence: repriced.priceSequence,
        },
      },
    );
    return {
      state: result.created ? "PUBLISHED" : "SKIPPED",
      reason: result.created ? null : "UNCHANGED",
      publicationId: result.publication.id,
      includes: repriced.priceSequence,
    };
  }

  /** A catalog's recent price publications, for members who see the catalog. */
  async pricePublications(
    context: HumanContext,
    companyId: string,
    catalogId: string,
  ): Promise<PriceIntentView[]> {
    const access = await this.#companies.resolve(context, companyId);
    if (!(await this.#catalogs.visible(access, catalogId)))
      throw new PublicationFailure("RESOURCE_NOT_FOUND");
    const items = await this.#intents.list(
      companyId,
      catalogId,
      priceIntentPolicy.listLimit,
    );
    const targets = await this.#programming.describePrograms(
      access,
      items.map((item) => item.programId),
    );
    return items.map((item) => this.#intentView(item, access, targets));
  }

  /**
   * Authorizes a blocked or failed price publication again: the caller
   * must be able to publish the program now, with strong authentication.
   * The intent keeps its author and is due at once on the caller's
   * authority, unless a pending one of the same program and catalog
   * already covers it.
   */
  async retryPricePublication(
    context: HumanContext,
    companyId: string,
    intentId: string,
  ): Promise<PriceIntentView> {
    const access = await this.#companies.resolve(context, companyId);
    const before = await this.#intents.find(companyId, intentId);
    const source = before
      ? await this.#programming.programSource(companyId, before.programId)
      : null;
    if (!before || !source) throw new PublicationFailure("RESOURCE_NOT_FOUND");
    const target = await this.#programming.target(
      null,
      access,
      source,
      publish,
    );
    const updated = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        target.branchIds,
      );
      const lockedTarget = await this.#programming.target(
        tx,
        locked.access,
        source,
        publish,
      );
      const current = await this.#intents.lock(tx, companyId, intentId);
      if (!current) throw new PublicationFailure("RESOURCE_NOT_FOUND");
      if (current.state !== "BLOCKED" && current.state !== "FAILED")
        throw new PublicationFailure("RESOURCE_VERSION_CONFLICT");
      const outcome = await this.#intents.reauthorize(
        tx,
        current,
        locked.access.membershipId,
      );
      await this.#repository.audit(
        tx,
        actorOf(context, locked.access),
        companyId,
        current.programId,
        lockedTarget.branchIds,
        "publication.price_reauthorized",
        {
          intentId,
          catalogId: current.catalogId,
          priceSequence: current.priceSequence,
          authorMembershipId: current.authorMembershipId,
          previousState: current.state,
          previousReason: current.reason,
          outcome,
        },
      );
      return this.#intents.find(companyId, intentId, tx);
    });
    if (!updated) throw new PublicationFailure("RESOURCE_NOT_FOUND");
    const targets = await this.#programming.describePrograms(access, [
      updated.programId,
    ]);
    return this.#intentView(updated, access, targets);
  }

  #intentView(
    item: PriceIntentRecord,
    access: CompanyAccess,
    targets: ReadonlyMap<
      string,
      Readonly<{ kind: "group" | "device"; id: string; name: string }>
    >,
  ): PriceIntentView {
    return {
      ...item,
      target: targets.get(item.programId) ?? null,
      authorIsCaller: item.authorMembershipId === access.membershipId,
    };
  }

  /**
   * Resolves the program's branches without locks for the organization lock
   * set, then runs the work after the organization locks.
   */
  async #withLocks<T>(
    context: HumanContext,
    companyId: string,
    source: ProgramSource,
    work: (tx: Prisma.TransactionClient, access: CompanyAccess) => Promise<T>,
  ): Promise<T> {
    const access = await this.#companies.resolve(context, companyId);
    const before = await this.#programming.target(
      null,
      access,
      source,
      publish,
    );
    return this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        before.branchIds,
      );
      return work(tx, locked.access);
    });
  }

  /** Builds the content of a program's current draft and its problems. */
  async #build(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    source: ProgramSource,
  ): Promise<Built> {
    const snapshot: ProgramSnapshot = await this.#programming.snapshot(
      tx,
      access,
      source,
      publish,
    );
    const problems: PublicationProblem[] = [];
    if (!snapshot.programId) problems.push({ code: "NOTHING_TO_PUBLISH" });
    // A program with a layout publishes protocol 2 (catalog and composition
    // design): its layout must still fit its reach, and its views publish.
    const layout = snapshot.layout;
    if (snapshot.layoutId && (!layout || !layout.usable))
      problems.push({ code: "LAYOUT_OUT_OF_SCOPE" });
    for (const problem of layout?.problems ?? [])
      problems.push({ code: problem.code, areaKey: problem.areaKey });
    if (snapshot.outputs.some((output) => !output.valid))
      problems.push({ code: "SCHEDULE_INVALID" });
    for (const playlist of snapshot.playlists) {
      if (!playlist.usable)
        problems.push({
          code: "PLAYLIST_OUT_OF_SCOPE",
          playlistId: playlist.id,
        });
      if (playlist.transition === "FADE")
        problems.push({
          code: "TRANSITION_UNSUPPORTED",
          playlistId: playlist.id,
        });
    }
    const mediaIds = [
      ...new Set([
        ...snapshot.playlists.flatMap((playlist) =>
          playlist.items.map((item) => item.mediaAssetId),
        ),
        ...(layout?.mediaIds ?? []),
      ]),
    ];
    const itemCount = snapshot.playlists.reduce(
      (sum, playlist) => sum + playlist.items.length,
      0,
    );
    const recordCount = (layout?.catalogs ?? []).reduce(
      (sum, catalog) => sum + catalog.records.length,
      0,
    );
    if (
      itemCount > publicationPolicy.maxItems ||
      mediaIds.length > publicationPolicy.maxMedia ||
      recordCount > publicationPolicy.maxRecords
    )
      problems.push({ code: "TOO_LARGE" });
    const described =
      mediaIds.length > publicationPolicy.maxMedia
        ? []
        : await this.#media.describeForPublication(
            tx,
            access.companyId,
            mediaIds,
          );
    const found = new Map(described.map((item) => [item.id, item]));
    const media: ManifestMedia[] = [];
    for (const id of mediaIds) {
      const item = found.get(id);
      if (!item || !publishable(item) || !item.display) {
        if (mediaIds.length <= publicationPolicy.maxMedia)
          problems.push({ code: "MEDIA_UNAVAILABLE", mediaId: id });
        continue;
      }
      media.push({
        id: item.id,
        kind: item.kind,
        contentType: item.display.contentType,
        size: item.display.size,
        sha256: item.display.sha256,
        width: item.width,
        height: item.height,
        durationMs: item.durationMs,
        hasAudio: item.hasAudio,
      });
    }
    const playlists: ManifestPlaylist[] = snapshot.playlists.map(
      (playlist) => ({
        id: playlist.id,
        transition:
          playlist.transition === "FADE"
            ? { kind: "FADE", durationMs: playlist.fadeMs ?? 0 }
            : { kind: "CUT" },
        items: playlist.items.map((item) => ({
          mediaId: item.mediaAssetId,
          durationMs: item.durationMs,
        })),
      }),
    );
    const outputs = new Map(
      snapshot.outputs.map((output) => [output.key, output]),
    );
    const payload: Payload = layout
      ? {
          protocol: 2,
          content: canonicalLayoutContent({
            layout: {
              orientation: layout.orientation,
              width: layout.width,
              height: layout.height,
              audioMixConfirmed: layout.audioMixConfirmed,
              areas: layout.areas,
              pages: layout.pages,
            },
            // Every area is an output; a catalog area defaults to its view.
            outputs: layout.areas.map((area) => {
              const output = outputs.get(area.key);
              return {
                key: area.key,
                default:
                  area.kind === "catalog"
                    ? { view: true }
                    : output?.defaultPlaylistId
                      ? { playlistId: output.defaultPlaylistId }
                      : null,
                rules: output?.rules ?? [],
              };
            }),
            catalogs: layout.catalogs,
            playlists,
            media,
          }),
        }
      : {
          protocol: 1,
          content: canonicalContent({
            outputs: snapshot.outputs.map((output) => ({
              key: output.key,
              defaultPlaylistId: output.defaultPlaylistId,
              rules: output.rules,
            })),
            playlists,
            media,
          }),
        };
    return {
      target: snapshot,
      payload,
      playlists: snapshot.playlists.map((playlist) => ({
        id: playlist.id,
        branchId: playlist.branchId,
      })),
      problems,
      counts: {
        rules: snapshot.outputs.reduce(
          (sum, output) => sum + output.rules.length,
          0,
        ),
        playlists: snapshot.playlists.length,
        items: itemCount,
        media: media.length,
        mediaBytes: media.reduce((sum, item) => sum + item.size, 0),
      },
      digest: digestOf(payload),
      catalogs: (layout?.catalogs ?? []).map((catalog) => ({
        catalogId: catalog.id,
        priceSequence: catalog.priceSequence,
      })),
    };
  }

  /**
   * Under the company's publication lock: returns the latest publication
   * when its content is the same, otherwise checks the limits and records
   * the next generation. For a protocol 2 generation it then settles the
   * price intents its catalog copies include and queues the price changes
   * they miss, on the publisher's authority. A price publication names the
   * generation it copied (`base`), and is refused with
   * RESOURCE_VERSION_CONFLICT when another one came first.
   */
  async #record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    input: {
      programId: string;
      branchIds: readonly string[];
      payload: Payload;
      digest: Buffer;
      counts: PublicationRecord["counts"];
      playlists: readonly Readonly<{ id: string; branchId: string | null }>[];
      restoredFromGeneration: number | null;
      origin: PublicationOrigin;
      catalogs: readonly CatalogCopy[];
      price?: Readonly<{
        base: string;
        intent: PriceIntentRecord;
        catalogId: string;
        priceSequence: number;
      }>;
    },
  ): Promise<{ publication: PublicationRecord; created: boolean }> {
    await this.#repository.lockCompany(tx, companyId);
    const latest = await this.#repository.latest(
      companyId,
      input.programId,
      tx,
    );
    if (input.price && latest?.id !== input.price.base)
      throw new PublicationFailure("RESOURCE_VERSION_CONFLICT");
    if (latest?.contentSha256.equals(input.digest))
      return { publication: latest, created: false };
    const recent = await this.#repository.recentCounts(
      tx,
      companyId,
      input.programId,
    );
    if (
      recent.programHour >= publicationPolicy.maxPerProgramPerHour ||
      recent.companyDay >= publicationPolicy.maxPerCompanyPerDay
    )
      throw new PublicationFailure("RATE_LIMITED");
    const id = randomUUID();
    const generation = (latest?.generation ?? 0) + 1;
    const publishedAt = new Date();
    const header = {
      publicationId: id,
      companyId,
      programId: input.programId,
      generation,
      publishedAt,
    };
    const manifest =
      input.payload.protocol === 2
        ? layoutManifestBytes(header, input.payload.content)
        : manifestBytes(header, input.payload.content);
    const publication = await this.#repository.insert(
      tx,
      actor,
      companyId,
      {
        id,
        programId: input.programId,
        branchIds: input.branchIds,
        generation,
        protocol: input.payload.protocol,
        contentSha256: input.digest,
        manifest: manifest.bytes,
        manifestSha256: manifest.sha256,
        counts: input.counts,
        restoredFromGeneration: input.restoredFromGeneration,
        origin: input.origin,
        publishedAt,
        playlists: input.playlists,
        catalogs: input.catalogs,
        media: input.payload.content.media.map((item) => ({
          id: item.id,
          sha256: Buffer.from(item.sha256, "hex"),
          size: item.size,
          contentType: item.contentType,
        })),
      },
      input.origin === "PRICE"
        ? "publication.price_published"
        : input.restoredFromGeneration === null
          ? "publication.published"
          : "publication.restored",
      {
        publicationId: id,
        generation,
        ...(input.restoredFromGeneration === null
          ? {}
          : { restoredFromGeneration: input.restoredFromGeneration }),
        ...(input.price
          ? {
              catalogId: input.price.catalogId,
              priceSequence: input.price.priceSequence,
              intentId: input.price.intent.id,
              authorMembershipId: input.price.intent.authorMembershipId,
            }
          : {}),
        rules: input.counts.rules,
        playlists: input.counts.playlists,
        items: input.counts.items,
        media: input.counts.media,
      },
    );
    if (input.catalogs.length > 0) {
      const current = await this.#catalogs.priceSequences(
        tx,
        companyId,
        input.catalogs.map((copy) => copy.catalogId),
      );
      for (const copy of input.catalogs) {
        await this.#intents.settle(
          tx,
          companyId,
          input.programId,
          copy,
          id,
          input.price?.intent.id ?? null,
        );
        // A price change committed after the copy was read, which no
        // intent covers yet, follows on the publisher's authority.
        const committed = current.get(copy.catalogId) ?? 0;
        if (committed > copy.priceSequence)
          await queueIntent(
            tx,
            companyId,
            input.programId,
            copy.catalogId,
            committed,
            actor.membershipId,
          );
      }
    }
    return { publication, created: true };
  }

  #view(row: PublicationRecord, access: CompanyAccess): PublicationView {
    return {
      ...row,
      state: row.prunedAt
        ? "pruned"
        : row.supersededAt
          ? "retained"
          : "current",
      isCaller: row.publishedByMembershipId === access.membershipId,
    };
  }

  // Screen states for the panel

  async syncState(
    context: HumanContext,
    companyId: string,
    deviceId: string,
  ): Promise<ScreenStateView> {
    const access = await this.#companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const [device] = await this.#devices.describe(null, companyId, [deviceId]);
    if (!device || decide(access, "devices.view", device.branchId) !== "allow")
      throw new PublicationFailure("RESOURCE_NOT_FOUND");
    if (device.status !== "ACTIVE") throw new DeviceFailure("DEVICE_UNLINKED");
    const states = await this.#repository.states(companyId, [deviceId]);
    return this.#stateView(companyId, deviceId, states.get(deviceId) ?? null);
  }

  async screenStates(
    context: HumanContext,
    companyId: string,
    deviceIds: readonly string[],
  ): Promise<ScreenStateView[]> {
    if (deviceIds.length > publicationPolicy.maxStateQuery)
      throw new PublicationFailure("VALIDATION_FAILED");
    const access = await this.#companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const devices = await this.#devices.describe(null, companyId, deviceIds);
    const visible = devices
      .filter(
        (device) =>
          device.status === "ACTIVE" &&
          decide(access, "devices.view", device.branchId) === "allow",
      )
      .map((device) => device.id)
      .sort();
    const states = await this.#repository.states(companyId, visible);
    return Promise.all(
      visible.map((id) =>
        this.#stateView(companyId, id, states.get(id) ?? null),
      ),
    );
  }

  async #stateView(
    companyId: string,
    deviceId: string,
    stored: StateRecord | null,
  ): Promise<ScreenStateView> {
    const current = await this.#programming.currentProgram(companyId, deviceId);
    const desired = current.programId
      ? await this.#repository.latest(companyId, current.programId)
      : null;
    const reportedIds = [
      stored?.activePublicationId,
      stored?.staging?.publicationId,
    ].filter((id): id is string => Boolean(id));
    const known = new Map(
      (await this.#repository.findMany(companyId, reportedIds)).map((row) => [
        row.id,
        row.generation,
      ]),
    );
    let publication: ScreenStateView["publication"];
    if (!stored) publication = "unknown";
    else if (!desired) publication = "neutral";
    else if (stored.activePublicationId === desired.id)
      publication = "up_to_date";
    else if (stored.staging?.publicationId === desired.id)
      publication = stored.staging.state === "FAILED" ? "failed" : "updating";
    else publication = "pending";
    return {
      deviceId,
      connection: connection(stored?.receivedAt ?? null, new Date()),
      lastContactAt: stored?.receivedAt ?? null,
      source: current.source,
      desired: desired
        ? { publicationId: desired.id, generation: desired.generation }
        : null,
      publication,
      reported: stored
        ? {
            ...stored,
            activeGeneration: stored.activePublicationId
              ? (known.get(stored.activePublicationId) ?? null)
              : null,
            stagingGeneration: stored.staging
              ? (known.get(stored.staging.publicationId) ?? null)
              : null,
          }
        : null,
    };
  }

  // Screens

  async sync(
    authorization: string | undefined,
    report: SyncReport,
  ): Promise<SyncAnswer> {
    const screen = await this.#devices.authenticate(authorization);
    const protocol = agreedProtocol(report.protocols);
    if (screen.status === "unlinked")
      return {
        protocol: protocol ?? publicationPolicy.protocols[0],
        serverTime: screen.serverTime,
        status: "unlinked",
        clearRequired: true,
        timeZone: null,
        zoneOffsets: null,
        rotation: null,
        branchId: null,
        desired: null,
        authorization: null,
        nextSyncSeconds: publicationPolicy.syncIntervalSeconds,
      };
    if (protocol === null) throw new PublicationFailure("PROTOCOL_UNSUPPORTED");
    const active = screen.status === "active";
    const current = await this.#programming.currentProgram(
      screen.companyId,
      screen.deviceId,
    );
    const desired =
      active && current.programId
        ? await this.#repository.latest(screen.companyId, current.programId)
        : null;
    await this.#repository.transaction(async (tx) => {
      const before = await this.#repository.state(
        screen.companyId,
        screen.deviceId,
        tx,
        true,
      );
      const next: Omit<StateRecord, "receivedAt"> = {
        deviceId: screen.deviceId,
        protocol,
        appVersion: report.appVersion,
        // A suspended company receives no answer to keep.
        desiredPublicationId: active
          ? (desired?.id ?? null)
          : (before?.desiredPublicationId ?? null),
        activePublicationId: report.active?.publicationId ?? null,
        activeSince: report.active ? new Date(report.active.activatedAt) : null,
        recoveryPublicationId: report.recovery?.publicationId ?? null,
        staging: report.staging
          ? {
              publicationId: report.staging.publicationId,
              state: report.staging.state,
              failure:
                report.staging.state === "FAILED"
                  ? (report.staging.failure ?? "DOWNLOAD_FAILED")
                  : null,
              bytesDone: report.staging.bytesDone,
              bytesTotal: report.staging.bytesTotal,
            }
          : null,
        playback: report.playback,
        storage:
          report.storage &&
          report.storage.freeBytes <= report.storage.totalBytes
            ? report.storage
            : null,
        deviceTime: report.deviceTime ? new Date(report.deviceTime) : null,
      };
      await this.#repository.writeState(
        tx,
        screen.companyId,
        next,
        transitions(before, next, active),
      );
    });
    let statement: string | null = null;
    if (active && screen.authorizedUntil) {
      const reported = (
        await this.#repository.findMany(
          screen.companyId,
          [report.active?.publicationId, report.recovery?.publicationId].filter(
            (id): id is string => Boolean(id),
          ),
        )
      )
        .filter((row) => !row.prunedAt)
        .map((row): AuthorizedPublication => ({
          id: row.id,
          sha256: row.manifestSha256.toString("hex"),
        }));
      statement = await signStatement(this.#keys, {
        sub: screen.deviceId,
        company: screen.companyId,
        iat: Math.floor(screen.serverTime.getTime() / 1000),
        exp: Math.floor(screen.authorizedUntil.getTime() / 1000),
        publications: authorizedPublications(
          desired
            ? { id: desired.id, sha256: desired.manifestSha256.toString("hex") }
            : null,
          report.active?.publicationId ?? null,
          reported,
        ),
      });
    }
    return {
      protocol,
      serverTime: screen.serverTime,
      status: screen.status,
      clearRequired: false,
      timeZone: screen.timeZone,
      zoneOffsets: screen.timeZone
        ? zoneOffsets(
            screen.timeZone,
            new Date(
              screen.serverTime.getTime() -
                publicationPolicy.zoneOffsetsBeforeDays * dayMs,
            ),
            new Date(
              screen.serverTime.getTime() +
                publicationPolicy.zoneOffsetsAfterDays * dayMs,
            ),
          )
        : null,
      rotation: screen.rotation,
      branchId: screen.branchId,
      desired: desired
        ? {
            publicationId: desired.id,
            generation: desired.generation,
            protocol: desired.protocol,
            manifestSha256: desired.manifestSha256.toString("hex"),
            manifestSize: desired.manifestSize,
            source: current.source,
          }
        : null,
      authorization: statement,
      nextSyncSeconds: publicationPolicy.syncIntervalSeconds,
    };
  }

  /** The current desired publication of an active screen, or not found. */
  async #desiredFor(
    authorization: string | undefined,
    publicationId?: string,
  ): Promise<{
    companyId: string;
    deviceId: string;
    publication: PublicationRecord;
  }> {
    const screen = await this.#devices.authenticate(authorization);
    if (screen.status !== "active")
      throw new PublicationFailure("RESOURCE_NOT_FOUND");
    const current = await this.#programming.currentProgram(
      screen.companyId,
      screen.deviceId,
    );
    const desired = current.programId
      ? await this.#repository.latest(screen.companyId, current.programId)
      : null;
    if (
      !desired ||
      (publicationId !== undefined && desired.id !== publicationId)
    )
      throw new PublicationFailure("RESOURCE_NOT_FOUND");
    return {
      companyId: screen.companyId,
      deviceId: screen.deviceId,
      publication: desired,
    };
  }

  async manifest(
    authorization: string | undefined,
    publicationId: string,
  ): Promise<{ bytes: Buffer; sha256: string }> {
    const { companyId, publication } = await this.#desiredFor(
      authorization,
      publicationId,
    );
    const bytes = await this.#repository.manifest(companyId, publication.id);
    if (!bytes) throw new PublicationFailure("RESOURCE_NOT_FOUND");
    return { bytes, sha256: publication.manifestSha256.toString("hex") };
  }

  /**
   * Admits one media download of the current desired publication. The
   * caller streams `open` and must call `release` when the response ends.
   */
  async media(
    authorization: string | undefined,
    mediaId: string,
  ): Promise<
    DeliveredMedia & {
      open(range?: { start: number; end: number }): Readable;
      release(): void;
    }
  > {
    const { companyId, deviceId, publication } =
      await this.#desiredFor(authorization);
    const delivered = await this.#repository.deliveredMedia(
      companyId,
      publication.id,
      mediaId,
    );
    if (!delivered) throw new PublicationFailure("RESOURCE_NOT_FOUND");
    const running = this.#downloads.get(deviceId) ?? 0;
    if (running >= publicationPolicy.maxConcurrentDownloads)
      throw new PublicationFailure("RATE_LIMITED");
    this.#downloads.set(deviceId, running + 1);
    let released = false;
    return {
      ...delivered,
      open: (range) =>
        this.#media.openObject(
          companyId,
          delivered.sha256.toString("hex"),
          range,
        ),
      release: () => {
        if (released) return;
        released = true;
        const left = (this.#downloads.get(deviceId) ?? 1) - 1;
        if (left > 0) this.#downloads.set(deviceId, left);
        else this.#downloads.delete(deviceId);
      },
    };
  }

  async keys(authorization: string | undefined): Promise<PublicKeySet> {
    await this.#devices.authenticate(authorization);
    this.#keySet ??= publicKeySet(this.#keys);
    return this.#keySet;
  }

  // Collaboration

  /** Prunes publications past their retention and old report transitions. */
  async maintain(): Promise<{ pruned: number; events: number }> {
    const pruned = await this.#repository.prune();
    const events = await this.#repository.purgeEvents();
    return { pruned, events };
  }
}

function publishable(item: PublishableMedia): boolean {
  return (
    (item.status === "READY" || item.status === "ARCHIVED") &&
    item.display !== null
  );
}

/** The report transitions worth keeping (AT-20). */
function transitions(
  before: StateRecord | null,
  next: Omit<StateRecord, "receivedAt">,
  answered: boolean,
): {
  kind: DeviceEventKind;
  publicationId: string | null;
  detail: string | null;
}[] {
  const events: {
    kind: DeviceEventKind;
    publicationId: string | null;
    detail: string | null;
  }[] = [];
  if (
    answered &&
    (!before || before.desiredPublicationId !== next.desiredPublicationId)
  )
    events.push({
      kind: "DESIRED_DELIVERED",
      publicationId: next.desiredPublicationId,
      detail: null,
    });
  if (
    next.activePublicationId &&
    before?.activePublicationId !== next.activePublicationId
  )
    events.push({
      kind: "ACTIVATED",
      publicationId: next.activePublicationId,
      detail: null,
    });
  if (
    next.staging?.state === "FAILED" &&
    (before?.staging?.state !== "FAILED" ||
      before.staging.publicationId !== next.staging.publicationId ||
      before.staging.failure !== next.staging.failure)
  )
    events.push({
      kind: "STAGING_FAILED",
      publicationId: next.staging.publicationId,
      detail: next.staging.failure,
    });
  if (before && before.playback !== next.playback)
    events.push({
      kind: "PLAYBACK_CHANGED",
      publicationId: null,
      detail: next.playback,
    });
  return events;
}
