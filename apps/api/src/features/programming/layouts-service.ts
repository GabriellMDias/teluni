import type { Prisma } from "../../generated/prisma/client.js";
import type {
  BindableCatalog,
  CatalogPort,
  CatalogViewData,
} from "../catalogs/public.js";
import type { HumanContext } from "../identity/public.js";
import { MediaFailure, type MediaPort } from "../media/public.js";
import {
  branchReach,
  decide,
  OrganizationFailure,
  requireCapability,
  type Capability,
  type CompanyAccess,
  type CompanyAccessPort,
} from "../organizations/public.js";
import { programmingPolicy, ProgrammingFailure, type Issue } from "./domain.js";
import {
  canvases,
  fitView,
  layoutDocument,
  layoutFormat,
  layoutName,
  layoutSchemaVersion,
  planLayout,
  roleAccepts,
  rowsPerPage,
  textWidth,
  type FitRecord,
  type LayoutDefinition,
  type LayoutDocument,
  type LayoutInput,
  type Overflow,
} from "./layouts.js";
import type {
  LayoutRecord,
  PrismaLayoutRepository,
} from "./layouts-repository.js";
import type { Actor } from "./prisma-repository.js";

export type AreaFit = Readonly<{
  areaKey: string;
  pages: number;
  records: number;
  rowsPerPage: number;
  /** Titles are given only to members who may view the catalog. */
  overflow: readonly (Overflow & { title: string | null })[];
}>;

export type LayoutView = LayoutRecord &
  Readonly<{
    branchName: string | null;
    definition: LayoutDefinition;
    catalogs: ReadonlyMap<string, BindableCatalog>;
    media: ReadonlyMap<
      string,
      { name: string; kind: string; status: string; durationMs: number | null }
    >;
    /** Seconds covering the longest video a page shows, when it shows one. */
    suggestedSeconds: readonly (number | null)[];
    fit: readonly AreaFit[];
  }>;

export type LayoutSummary = LayoutRecord &
  Readonly<{ branchName: string | null; areaCount: number; pageCount: number }>;

type Cursor = { c: string; p: string; r: string; t: string; i: string };

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(
  value: string | undefined,
  binding: { company: string; principal: string; scope: string },
): Cursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("encoding");
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<Cursor> | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.c === binding.company &&
      parsed.p === binding.principal &&
      parsed.r === binding.scope &&
      typeof parsed.t === "string" &&
      !Number.isNaN(new Date(parsed.t).getTime()) &&
      typeof parsed.i === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.i,
      )
    )
      return parsed as Cursor;
  } catch {
    // Malformed cursors answer like foreign ones.
  }
  throw new ProgrammingFailure("VALIDATION_FAILED");
}

function requireActive(access: CompanyAccess): void {
  if (access.companyStatus === "SUSPENDED")
    throw new OrganizationFailure("COMPANY_SUSPENDED");
}

function viewsAnything(access: CompanyAccess): boolean {
  const reach = branchReach(access, "programming.view");
  return reach === "all" || reach.size > 0;
}

/** Company layouts are visible to every viewer; branch ones per branch. */
/** Company layouts for anyone who views programming; branch ones by grant. */
export function layoutVisible(
  access: CompanyAccess,
  item: Pick<LayoutRecord, "branchId">,
): boolean {
  return item.branchId === null
    ? viewsAnything(access)
    : decide(access, "programming.view", item.branchId) === "allow";
}

function requireLayout(
  access: CompanyAccess,
  capability: Capability,
  item: LayoutRecord,
): void {
  requireActive(access);
  if (!layoutVisible(access, item))
    throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
  requireCapability(access, capability, item.branchId ?? undefined);
}

/** Whether a member may see a catalog's records (titles in fit reports). */
function catalogViewer(access: CompanyAccess, branchId: string | null) {
  if (branchId !== null)
    return decide(access, "catalogs.view", branchId) === "allow";
  const reach = branchReach(access, "catalogs.view");
  return reach === "all" || reach.size > 0;
}

/** Content of a company scope fits every layout; a branch's only its own. */
const fits = (owner: string | null, layoutBranch: string | null) =>
  owner === null || owner === layoutBranch;

const actorOf = (context: HumanContext, access: CompanyAccess): Actor => ({
  principalId: context.principalId,
  membershipId: access.membershipId,
});

const weekdayNames = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/**
 * A price as screens may show it: the wider of its pt-BR and en-US currency
 * formats, since the screen's locale is chosen later.
 */
function priceText(amount: number, currency: string): string {
  const digits =
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const text = String(amount).padStart(digits + 1, "0");
  const decimal = (
    digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`
  ) as Intl.StringNumericLiteral;
  const formatted = ["pt-BR", "en-US"].map((locale) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      decimal,
    ),
  );
  return formatted.reduce((wide, next) =>
    textWidth(next, 1) > textWidth(wide, 1) ? next : wide,
  );
}

/**
 * What layouts need from programs, which the programming service provides:
 * whether programs use a layout, and the outputs a save removes from them.
 */
export type LayoutPrograms = Readonly<{
  layoutInUse(
    tx: Prisma.TransactionClient,
    companyId: string,
    layoutId: string,
  ): Promise<boolean>;
  /**
   * After the layout's lock: locks the programs that use it and drops the
   * outputs of areas the new definition no longer has, and the defaults of
   * areas that become catalog areas. With content to drop and no
   * confirmation, throws LAYOUT_CHANGE_CONFIRMATION_REQUIRED naming them.
   */
  reconcileLayoutOutputs(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    layoutId: string,
    areas: readonly { key: string; kind: "media" | "catalog" }[],
    confirmed: boolean,
  ): Promise<void>;
}>;

export type LayoutQuery = Readonly<{
  limit: number;
  cursor?: string;
  scope?: string;
  text?: string;
}>;

/** Layouts of the programming module over catalogs and media. */
export class LayoutService {
  readonly #repository: PrismaLayoutRepository;
  readonly #companies: CompanyAccessPort;
  readonly #catalogs: CatalogPort;
  readonly #media: MediaPort;
  readonly #programs: LayoutPrograms;

  constructor(options: {
    repository: PrismaLayoutRepository;
    companies: CompanyAccessPort;
    catalogs: CatalogPort;
    media: MediaPort;
    programs: LayoutPrograms;
  }) {
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#catalogs = options.catalogs;
    this.#media = options.media;
    this.#programs = options.programs;
  }

  async createLayout(
    context: HumanContext,
    companyId: string,
    input: {
      name: string;
      branchId: string | null;
      definition: LayoutInput;
      prefix?: string;
    },
  ): Promise<LayoutView> {
    const name = layoutName(input.name);
    const definition = planLayout(input.definition, input.prefix ?? "");
    const scope = input.branchId ?? undefined;
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    requireCapability(access, "programming.edit", scope);
    const created = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        input.branchId ? [input.branchId] : [],
      );
      requireActive(locked.access);
      requireCapability(locked.access, "programming.edit", scope);
      if (input.branchId && !locked.activeBranchIds.has(input.branchId))
        throw new ProgrammingFailure("VALIDATION_FAILED");
      if (
        (await this.#repository.countLayouts(tx, companyId)) >=
        programmingPolicy.maxLayoutsPerCompany
      )
        throw new ProgrammingFailure("PROGRAMMING_LIMIT_REACHED");
      await this.#checkReferences(
        tx,
        locked.access,
        input.branchId,
        definition,
        null,
        input.prefix ?? "",
      );
      const item = await this.#repository.createLayout(tx, {
        companyId,
        branchId: input.branchId,
        name,
        definition,
      });
      await this.#repository.audit(
        tx,
        companyId,
        actorOf(context, locked.access),
        item.id,
        input.branchId ? [input.branchId] : [],
        input.prefix ? "layout.imported" : "layout.created",
        {
          name,
          areas: definition.areas.length,
          pages: definition.pages.length,
        },
      );
      return item;
    });
    return this.#view(access, created);
  }

  /** Creates a layout from its `teluni.layout` text representation. */
  importLayout(
    context: HumanContext,
    companyId: string,
    input: { branchId: string | null; document: LayoutDocument },
  ): Promise<LayoutView> {
    const document = input.document;
    if (
      document.format !== layoutFormat ||
      document.schema !== layoutSchemaVersion
    )
      throw new ProgrammingFailure("LAYOUT_INVALID", [
        { path: "/document/schema", reason: "FORMAT_UNSUPPORTED" },
      ]);
    return this.createLayout(context, companyId, {
      name: document.name,
      branchId: input.branchId,
      definition: document,
      prefix: "/document",
    });
  }

  async listLayouts(
    context: HumanContext,
    companyId: string,
    query: LayoutQuery,
  ): Promise<{ items: LayoutSummary[]; nextCursor: string | null }> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    const reach = branchReach(access, "programming.view");
    if (reach !== "all" && reach.size === 0)
      requireCapability(access, "programming.view");
    if (
      query.scope &&
      query.scope !== "company" &&
      reach !== "all" &&
      !reach.has(query.scope)
    )
      return { items: [], nextCursor: null };
    const text = query.text?.trim() || undefined;
    const scope = [
      reach === "all" ? "all" : [...reach].sort().join(","),
      query.scope ?? "",
      text ?? "",
    ].join("|");
    const cursor = decodeCursor(query.cursor, {
      company: companyId,
      principal: context.principalId,
      scope,
    });
    const rows = await this.#repository.listLayouts(companyId, reach, {
      limit: query.limit + 1,
      ...(query.scope ? { scope: query.scope } : {}),
      ...(text ? { text } : {}),
      ...(cursor
        ? { before: { createdAt: new Date(cursor.t), id: cursor.i } }
        : {}),
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const names = await this.#branchNames(companyId, page);
    const definitions = await Promise.all(
      page.map((item) => this.#repository.definition(item)),
    );
    return {
      items: page.map((item, index) => ({
        ...item,
        branchName: item.branchId ? (names.get(item.branchId) ?? null) : null,
        areaCount: definitions[index]?.areas.length ?? 0,
        pageCount: definitions[index]?.pages.length ?? 0,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              r: scope,
              t: last.createdAt.toISOString(),
              i: last.id,
            })
          : null,
    };
  }

  async getLayout(
    context: HumanContext,
    companyId: string,
    layoutId: string,
  ): Promise<LayoutView> {
    const { access, item } = await this.#visible(context, companyId, layoutId);
    return this.#view(access, item);
  }

  async exportLayout(
    context: HumanContext,
    companyId: string,
    layoutId: string,
  ): Promise<LayoutDocument> {
    const { item } = await this.#visible(context, companyId, layoutId);
    return layoutDocument(item.name, await this.#repository.definition(item));
  }

  /** Renames a layout and/or replaces its whole definition. */
  async saveLayout(
    context: HumanContext,
    companyId: string,
    layoutId: string,
    expectedVersion: number,
    changes: {
      name?: string;
      definition?: LayoutInput;
      confirmRemovedOutputs?: boolean;
    },
  ): Promise<LayoutView> {
    if (changes.name === undefined && changes.definition === undefined)
      throw new ProgrammingFailure("VALIDATION_FAILED");
    const name =
      changes.name === undefined ? undefined : layoutName(changes.name);
    const definition =
      changes.definition === undefined
        ? undefined
        : planLayout(changes.definition);
    const { access, changed } = await this.#change(
      context,
      companyId,
      layoutId,
      expectedVersion,
      "update",
      async (tx, current, locked, actor) => {
        if (definition)
          await this.#programs.reconcileLayoutOutputs(
            tx,
            actor,
            companyId,
            current.id,
            definition.areas,
            changes.confirmRemovedOutputs ?? false,
          );
        if (definition)
          await this.#checkReferences(
            tx,
            locked,
            current.branchId,
            definition,
            await this.#repository.definition(current, tx),
            "",
          );
        const updated = await this.#repository.saveDefinition(tx, current, {
          ...(name !== undefined ? { name } : {}),
          ...(definition ? { definition } : {}),
        });
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          current.id,
          current.branchId ? [current.branchId] : [],
          definition ? "layout.saved" : "layout.renamed",
          {
            ...(name !== undefined && name !== current.name
              ? { from: current.name, to: name }
              : {}),
            ...(definition
              ? {
                  areas: definition.areas.length,
                  pages: definition.pages.length,
                }
              : {}),
            version: updated.version,
          },
        );
        return updated;
      },
    );
    return this.#view(access, changed);
  }

  async deleteLayout(
    context: HumanContext,
    companyId: string,
    layoutId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.#change(
      context,
      companyId,
      layoutId,
      expectedVersion,
      "delete",
      async (tx, current, _access, actor) => {
        if (await this.#programs.layoutInUse(tx, companyId, current.id))
          throw new ProgrammingFailure("LAYOUT_IN_USE");
        await this.#repository.deleteLayout(tx, current);
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          current.id,
          current.branchId ? [current.branchId] : [],
          "layout.deleted",
          { name: current.name },
        );
        return current;
      },
    );
  }

  /** Catalogs guard: layouts protect the catalogs and fields they bind. */
  catalogUsage = (
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogId: string,
  ) => this.#repository.catalogUsage(tx, companyId, catalogId);

  /** Media reference guard: layout pages protect the media they name. */
  mediaReferences = async (
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
  ) =>
    (await this.#repository.layoutsUsingMedia(tx, companyId, assetId)).map(
      (row) => ({ kind: "layout-draft", branchId: row.branchId }),
    );

  // Shared steps

  async #visible(
    context: HumanContext,
    companyId: string,
    layoutId: string,
  ): Promise<{ access: CompanyAccess; item: LayoutRecord }> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    const item = await this.#repository.findLayout(companyId, layoutId);
    if (!item || !layoutVisible(access, item))
      throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    return { access, item };
  }

  async #change(
    context: HumanContext,
    companyId: string,
    layoutId: string,
    expectedVersion: number,
    mode: "update" | "delete",
    change: (
      tx: Prisma.TransactionClient,
      current: LayoutRecord,
      access: CompanyAccess,
      actor: Actor,
    ) => Promise<LayoutRecord>,
  ): Promise<{ access: CompanyAccess; changed: LayoutRecord }> {
    const before = await this.#repository.findLayout(companyId, layoutId);
    if (!before) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
    return this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        before.branchId ? [before.branchId] : [],
      );
      const current = await this.#repository.lockLayout(
        tx,
        companyId,
        layoutId,
        mode,
      );
      if (!current) throw new ProgrammingFailure("RESOURCE_NOT_FOUND");
      requireLayout(locked.access, "programming.edit", current);
      if (current.version !== expectedVersion)
        throw new ProgrammingFailure("RESOURCE_VERSION_CONFLICT");
      return {
        access: locked.access,
        changed: await change(
          tx,
          current,
          locked.access,
          actorOf(context, locked.access),
        ),
      };
    });
  }

  /**
   * Checks what the definition names against stored data: views bind
   * active, visible catalogs that cover the layout's scope, with fields
   * whose types fit their roles; pages name media of the layout's scope
   * that lasts no longer than the page, and group choices of the view's
   * group field. What the stored definition already names may stay.
   */
  async #checkReferences(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    branchId: string | null,
    definition: LayoutDefinition,
    previous: LayoutDefinition | null,
    prefix: string,
  ): Promise<void> {
    const issues: Issue[] = [];
    const keptCatalogs = new Set(
      (previous?.areas ?? []).flatMap((area) =>
        area.view ? [area.view.catalogId] : [],
      ),
    );
    const wanted = [
      ...new Set(
        definition.areas.flatMap((area) =>
          area.view ? [area.view.catalogId] : [],
        ),
      ),
    ];
    const bindable = new Map(
      (
        await this.#catalogs.requireBindable(
          tx,
          access,
          wanted.filter((id) => !keptCatalogs.has(id)),
        )
      ).map((catalog) => [catalog.id, catalog]),
    );
    for (const catalog of await this.#catalogs.describe(
      access.companyId,
      wanted.filter((id) => keptCatalogs.has(id)),
    ))
      bindable.set(catalog.id, catalog);
    const groupChoices = new Map<string, Set<string>>();
    definition.areas.forEach((area, index) => {
      const view = area.view;
      if (!view) return;
      const path = `${prefix}/areas/${index}/view`;
      const catalog = bindable.get(view.catalogId);
      if (!catalog) {
        issues.push({
          path: `${path}/catalogId`,
          reason: "CATALOG_UNAVAILABLE",
        });
        return;
      }
      if (!fits(catalog.branchId, branchId))
        issues.push({ path: `${path}/catalogId`, reason: "CATALOG_SCOPE" });
      const fields = new Map(catalog.fields.map((field) => [field.id, field]));
      view.fields.forEach((bound, position) => {
        const field = fields.get(bound.fieldId);
        const at = `${path}/fields/${position}`;
        if (!field || field.archived)
          issues.push({ path: `${at}/fieldId`, reason: "FIELD_UNAVAILABLE" });
        else if (!roleAccepts(bound.role, view.presentation, field.type))
          issues.push({ path: `${at}/role`, reason: "ROLE_TYPE_MISMATCH" });
        else if (bound.role === "group")
          // An agenda's groups are ISO weekdays, named "1" to "7".
          groupChoices.set(
            area.key,
            new Set(
              field.type === "weekdays"
                ? weekdayNames.map((_, day) => String(day + 1))
                : field.choices.map((choice) => choice.id),
            ),
          );
      });
    });
    const keptMedia = new Set(
      (previous?.pages ?? []).flatMap((page) =>
        page.contents.flatMap((content) =>
          content.mediaAssetId ? [content.mediaAssetId] : [],
        ),
      ),
    );
    const durations = new Map<string, number | null>();
    const mediaIds = [
      ...new Set(
        definition.pages.flatMap((page) =>
          page.contents.flatMap((content) =>
            content.mediaAssetId ? [content.mediaAssetId] : [],
          ),
        ),
      ),
    ];
    for (const fact of await this.#media.describe(
      access.companyId,
      mediaIds.filter((id) => keptMedia.has(id)),
    ))
      durations.set(fact.id, fact.durationMs);
    const unavailable = new Set<string>();
    const outOfScope = new Set<string>();
    for (const id of mediaIds.filter((id) => !keptMedia.has(id)))
      try {
        const [selected] = await this.#media.requireSelectable(tx, access, [
          id,
        ]);
        if (!selected) unavailable.add(id);
        else {
          if (!fits(selected.branchId, branchId)) outOfScope.add(id);
          durations.set(id, selected.durationMs);
        }
      } catch (error) {
        if (!(error instanceof MediaFailure)) throw error;
        unavailable.add(id);
      }
    definition.pages.forEach((page, index) => {
      page.contents.forEach((content, position) => {
        const at = `${prefix}/pages/${index}/contents/${position}`;
        const media = content.mediaAssetId;
        if (media !== null) {
          if (unavailable.has(media) || !durations.has(media))
            issues.push({
              path: `${at}/mediaAssetId`,
              reason: "MEDIA_UNAVAILABLE",
            });
          else if (outOfScope.has(media))
            issues.push({ path: `${at}/mediaAssetId`, reason: "MEDIA_SCOPE" });
          else if ((durations.get(media) ?? 0) > page.durationSeconds * 1000)
            issues.push({
              path: `${prefix}/pages/${index}/durationSeconds`,
              reason: "PAGE_SHORTER_THAN_VIDEO",
            });
        }
        if (
          content.groupChoiceId !== null &&
          !groupChoices.get(content.areaKey)?.has(content.groupChoiceId)
        )
          issues.push({ path: `${at}/groupChoiceId`, reason: "GROUP_UNKNOWN" });
      });
    });
    if (issues.length > 0)
      throw new ProgrammingFailure("LAYOUT_INVALID", issues);
  }

  async #branchNames(
    companyId: string,
    items: readonly { branchId: string | null }[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        items.flatMap((item) => (item.branchId ? [item.branchId] : [])),
      ),
    ];
    if (ids.length === 0) return new Map();
    const described = await this.#companies.describe(companyId, ids);
    return new Map(
      [...described.branches].map(([id, branch]) => [id, branch.name]),
    );
  }

  async #view(access: CompanyAccess, item: LayoutRecord): Promise<LayoutView> {
    const definition = await this.#repository.definition(item);
    const catalogIds = [
      ...new Set(
        definition.areas.flatMap((area) =>
          area.view ? [area.view.catalogId] : [],
        ),
      ),
    ];
    const catalogs = new Map(
      (await this.#catalogs.describe(item.companyId, catalogIds)).map(
        (catalog) => [catalog.id, catalog],
      ),
    );
    const mediaIds = [
      ...new Set(
        definition.pages.flatMap((page) =>
          page.contents.flatMap((content) =>
            content.mediaAssetId ? [content.mediaAssetId] : [],
          ),
        ),
      ),
    ];
    const media = new Map(
      (await this.#media.describe(item.companyId, mediaIds)).map((fact) => [
        fact.id,
        {
          name: fact.name,
          kind: fact.kind,
          status: fact.status,
          durationMs: fact.durationMs,
        },
      ]),
    );
    const suggestedSeconds = definition.pages.map((page) => {
      const longest = Math.max(
        0,
        ...page.contents.map((content) =>
          content.mediaAssetId
            ? (media.get(content.mediaAssetId)?.durationMs ?? 0)
            : 0,
        ),
      );
      return longest > 0 ? Math.ceil(longest / 1000) : null;
    });
    const fit: AreaFit[] = [];
    for (const area of definition.areas) {
      if (!area.view) continue;
      const data = await this.#catalogs.viewData(
        item.companyId,
        area.view.catalogId,
      );
      const records = data ? fitRecords(area.view, data) : [];
      const result = fitView(area.view, area, records);
      const titled =
        data !== null && catalogViewer(access, data.catalog.branchId);
      const titles = new Map(
        records.map((record) => [record.id, record.title]),
      );
      fit.push({
        areaKey: area.key,
        pages: result.pages,
        records: result.records,
        rowsPerPage: rowsPerPage(area.view, area),
        overflow: result.overflow.map((entry) => ({
          ...entry,
          title: titled ? (titles.get(entry.recordId) ?? null) : null,
        })),
      });
    }
    const names = await this.#branchNames(item.companyId, [item]);
    return {
      ...item,
      branchName: item.branchId ? (names.get(item.branchId) ?? null) : null,
      definition,
      catalogs,
      media,
      suggestedSeconds,
      fit,
    };
  }
}

/** The canvas of a layout, for wire views. */
export const canvasOf = (item: LayoutRecord) => canvases[item.orientation];

/**
 * The records a view shows as text, with the widest price each may show.
 * An agenda shows a record once per weekday it lists.
 */
function fitRecords(
  view: NonNullable<LayoutDefinition["areas"][number]["view"]>,
  data: CatalogViewData,
): FitRecord[] {
  const fields = new Map(data.catalog.fields.map((field) => [field.id, field]));
  const role = (name: string) =>
    view.fields.filter((field) => field.role === name);
  const text = (
    fieldId: string,
    values: CatalogViewData["records"][number]["values"],
  ): string | null => {
    const field = fields.get(fieldId);
    const value = values[fieldId];
    if (!field || value === undefined) return null;
    switch (field.type) {
      case "boolean":
        return "Não";
      case "weekdays":
        return Array.isArray(value)
          ? value.map((day) => weekdayNames[day - 1] ?? "").join(", ")
          : null;
      case "selection":
        return (
          field.choices.find((choice) => choice.id === value)?.label ?? null
        );
      case "reference":
        return typeof value === "string"
          ? (data.referenceTitles.get(value) ?? null)
          : null;
      case "date":
        return "00/00/0000";
      default:
        return String(value);
    }
  };
  const title = role("title")[0];
  const subtitle = role("subtitle")[0];
  const price = role("price")[0];
  const group = role("group")[0];
  const image = role("image")[0];
  const details = role("detail");
  const timeField = view.fields.find(
    (field) => fields.get(field.fieldId)?.type === "time",
  );
  const records: FitRecord[] = [];
  for (const record of data.records) {
    let widest: string | null = null;
    if (price) {
      const facts = data.prices.get(record.id)?.get(price.fieldId);
      const currency = fields.get(price.fieldId)?.currency ?? "BRL";
      const amounts = facts
        ? [
            ...(facts.base !== null ? [facts.base] : []),
            ...facts.overrides.values(),
            ...facts.promotions.map((promotion) => promotion.amount),
          ]
        : [];
      for (const amount of amounts) {
        const formatted = priceText(amount, currency);
        if (widest === null || textWidth(formatted, 1) > textWidth(widest, 1))
          widest = formatted;
      }
    }
    const base: Omit<FitRecord, "group"> = {
      id: record.id,
      available: record.available,
      title: (title ? text(title.fieldId, record.values) : null) ?? "",
      subtitle: subtitle ? text(subtitle.fieldId, record.values) : null,
      details: details.flatMap((detail) => {
        const value = text(detail.fieldId, record.values);
        return value === null ? [] : [value];
      }),
      price: widest,
      hasImage: image ? record.values[image.fieldId] !== undefined : false,
      time: timeField
        ? ((record.values[timeField.fieldId] as string | undefined) ?? null)
        : null,
    };
    if (!group) {
      records.push({ ...base, group: null });
      continue;
    }
    const value = record.values[group.fieldId];
    if (view.presentation === "agenda") {
      if (Array.isArray(value))
        for (const day of value as readonly number[])
          records.push({ ...base, group: day });
      continue;
    }
    const choices = fields.get(group.fieldId)?.choices ?? [];
    const position = choices.findIndex((choice) => choice.id === value);
    records.push({
      ...base,
      group: position === -1 ? choices.length : position,
    });
  }
  // Grouped lists show each group's records together, groups in choice order.
  if (group && view.presentation !== "agenda")
    records.sort((a, b) => (a.group ?? 0) - (b.group ?? 0));
  return records;
}
