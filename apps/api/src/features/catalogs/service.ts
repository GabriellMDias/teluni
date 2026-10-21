import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
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
import {
  CatalogFailure,
  catalogName,
  catalogPolicy,
  effectivePrice,
  isAmount,
  isLocalMinute,
  linksOf,
  planSchema,
  planValues,
  promotionsConflict,
  titleField,
  type EffectivePrice,
  type FieldDefinition,
  type FieldInput,
  type Issue,
  type Promotion,
  type SchemaCheck,
  type Values,
} from "./domain.js";
import type {
  BindableCatalog,
  CatalogUsageGuard,
  CatalogViewData,
  PriceChangeListener,
} from "./public.js";
import {
  positionGap,
  type Actor,
  type CatalogData,
  type CatalogStatus,
  type PrismaCatalogRepository,
  type PromotionData,
  type RecordData,
} from "./prisma-repository.js";

export type CatalogView = CatalogData &
  Readonly<{
    branchName: string | null;
    fields: readonly FieldDefinition[];
    recordCount: number;
  }>;

export type RecordView = RecordData &
  Readonly<{
    title: string | null;
    overrides: readonly {
      fieldId: string;
      branchId: string;
      branchName: string;
      amount: number;
    }[];
    media: readonly {
      fieldId: string;
      mediaAssetId: string;
      name: string | null;
      status: string | null;
    }[];
    references: readonly {
      fieldId: string;
      recordId: string;
      title: string | null;
    }[];
  }>;

export type PromotionView = PromotionData &
  Readonly<{ branchName: string | null }>;

export type EffectivePricesView = Readonly<{
  at: string;
  fields: readonly {
    fieldId: string;
    currency: string;
    scope: EffectivePrice;
    branches: readonly (EffectivePrice & {
      branchId: string;
      branchName: string;
    })[];
  }[];
}>;

export type CatalogQuery = Readonly<{
  limit: number;
  cursor?: string;
  scope?: string;
  text?: string;
  status?: CatalogStatus;
}>;

export type RecordQuery = Readonly<{
  limit: number;
  cursor?: string;
  text?: string;
}>;

type Cursor = { c: string; p: string; r: string; k: string; i: string };
const uuidShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** A cursor bound to the company, caller and filters it was issued for. */
function decodeCursor(
  value: string | undefined,
  binding: { company: string; principal: string; scope: string },
  key: (raw: string) => boolean,
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
      typeof parsed.k === "string" &&
      key(parsed.k) &&
      typeof parsed.i === "string" &&
      uuidShape.test(parsed.i)
    )
      return parsed as Cursor;
  } catch {
    // Malformed cursors answer like foreign ones.
  }
  throw new CatalogFailure("VALIDATION_FAILED");
}

function requireActive(access: CompanyAccess): void {
  if (access.companyStatus === "SUSPENDED")
    throw new OrganizationFailure("COMPANY_SUSPENDED");
}

function viewsAnything(access: CompanyAccess): boolean {
  const reach = branchReach(access, "catalogs.view");
  return reach === "all" || reach.size > 0;
}

/** Company catalogs are visible to every viewer; branch ones per branch. */
function catalogVisible(access: CompanyAccess, item: CatalogData): boolean {
  return item.branchId === null
    ? viewsAnything(access)
    : decide(access, "catalogs.view", item.branchId) === "allow";
}

const branchVisible = (access: CompanyAccess, branchId: string) =>
  decide(access, "catalogs.view", branchId) === "allow";

function requireCatalog(
  access: CompanyAccess,
  capability: Capability,
  item: CatalogData,
): void {
  requireActive(access);
  if (!catalogVisible(access, item))
    throw new CatalogFailure("RESOURCE_NOT_FOUND");
  requireCapability(access, capability, item.branchId ?? undefined);
}

function requireWritable(item: CatalogData): void {
  if (item.status === "ARCHIVED") throw new CatalogFailure("CATALOG_ARCHIVED");
}

/** An active money field of the catalog, or RESOURCE_NOT_FOUND. */
function moneyField(
  fields: readonly FieldDefinition[],
  fieldId: string,
): FieldDefinition {
  const found = fields.find((field) => field.id === fieldId);
  if (!found || found.type !== "money" || found.archived)
    throw new CatalogFailure("RESOURCE_NOT_FOUND");
  return found;
}

const actorOf = (context: HumanContext, access: CompanyAccess): Actor => ({
  principalId: context.principalId,
  membershipId: access.membershipId,
});

type Locked = Readonly<{
  tx: Prisma.TransactionClient;
  access: CompanyAccess;
  activeBranchIds: ReadonlySet<string>;
  catalog: CatalogData;
  actor: Actor;
}>;

/** Catalogs, records and prices over the organizations and media boundaries. */
export class CatalogService {
  readonly #repository: PrismaCatalogRepository;
  readonly #companies: CompanyAccessPort;
  readonly #media: MediaPort;
  readonly #guards: readonly CatalogUsageGuard[];
  readonly #priceListeners: readonly PriceChangeListener[];

  constructor(options: {
    repository: PrismaCatalogRepository;
    companies: CompanyAccessPort;
    media: MediaPort;
    /** Registered by binding modules; read on every check. */
    guards?: readonly CatalogUsageGuard[];
    /** Registered by the publications module; run by every price change. */
    priceListeners?: readonly PriceChangeListener[];
  }) {
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#media = options.media;
    this.#guards = options.guards ?? [];
    this.#priceListeners = options.priceListeners ?? [];
  }

  /**
   * After a price write in its transaction: counts the change and lets the
   * listeners queue it for publication. A listener's refusal (the author
   * cannot publish a program that shows the catalog) refuses the change.
   */
  async #priceChanged(locked: Locked, branchId: string | null): Promise<void> {
    const { tx, access, catalog } = locked;
    const sequence = await this.#repository.nextPriceSequence(
      tx,
      catalog.companyId,
      catalog.id,
    );
    for (const listener of this.#priceListeners)
      if (
        !(await listener(tx, {
          access,
          catalogId: catalog.id,
          branchId,
          sequence,
        }))
      )
        throw new CatalogFailure("PRICE_TARGET_FORBIDDEN");
  }

  /** Layouts binding a catalog and each field, summed over every guard. */
  async #usage(
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogId: string,
  ): Promise<{ layouts: number; fields: Map<string, number> }> {
    const total = { layouts: 0, fields: new Map<string, number>() };
    for (const guard of this.#guards) {
      const usage = await guard(tx, companyId, catalogId);
      total.layouts += usage.layouts;
      for (const [fieldId, count] of usage.fields)
        total.fields.set(fieldId, (total.fields.get(fieldId) ?? 0) + count);
    }
    return total;
  }

  // Catalogs

  async createCatalog(
    context: HumanContext,
    companyId: string,
    input: {
      name: string;
      branchId: string | null;
      fields?: readonly FieldInput[];
    },
  ): Promise<CatalogView> {
    const name = catalogName(input.name);
    const plan = planSchema([], input.fields ?? [], randomUUID);
    const scope = input.branchId ?? undefined;
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    requireCapability(access, "catalogs.manage", scope);
    const created = await this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        input.branchId ? [input.branchId] : [],
      );
      requireActive(locked.access);
      requireCapability(locked.access, "catalogs.manage", scope);
      if (input.branchId && !locked.activeBranchIds.has(input.branchId))
        throw new CatalogFailure("VALIDATION_FAILED");
      const issues = await this.#targetIssues(
        tx,
        locked.access,
        { companyId, branchId: input.branchId, id: null },
        plan.checks,
      );
      if (issues.length > 0)
        throw new CatalogFailure("CATALOG_SCHEMA_INVALID", issues);
      if (
        (await this.#repository.countCatalogs(tx, companyId)) >=
        catalogPolicy.maxCatalogsPerCompany
      )
        throw new CatalogFailure("CATALOG_LIMIT_REACHED");
      const item = await this.#repository.createCatalog(tx, {
        companyId,
        branchId: input.branchId,
        name,
      });
      await this.#repository.replaceFields(tx, item, plan.fields, []);
      await this.#repository.audit(
        tx,
        companyId,
        actorOf(context, locked.access),
        { catalogId: item.id },
        [item.branchId],
        "catalog.created",
        { name, fields: plan.changes.added },
      );
      return item;
    });
    return (await this.#catalogViews(companyId, [created]))[0];
  }

  async listCatalogs(
    context: HumanContext,
    companyId: string,
    query: CatalogQuery,
  ): Promise<{ items: CatalogView[]; nextCursor: string | null }> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    const reach = branchReach(access, "catalogs.view");
    if (reach !== "all" && reach.size === 0)
      requireCapability(access, "catalogs.view");
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
      query.status ?? "",
    ].join("|");
    const cursor = decodeCursor(
      query.cursor,
      { company: companyId, principal: context.principalId, scope },
      (raw) => !Number.isNaN(new Date(raw).getTime()),
    );
    const rows = await this.#repository.listCatalogs(companyId, reach, {
      limit: query.limit + 1,
      ...(query.scope ? { scope: query.scope } : {}),
      ...(text ? { text } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(cursor
        ? { before: { createdAt: new Date(cursor.k), id: cursor.i } }
        : {}),
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.#catalogViews(companyId, page),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              r: scope,
              k: last.createdAt.toISOString(),
              i: last.id,
            })
          : null,
    };
  }

  async getCatalog(
    context: HumanContext,
    companyId: string,
    catalogId: string,
  ): Promise<CatalogView> {
    const item = await this.#visibleCatalog(context, companyId, catalogId);
    return (await this.#catalogViews(companyId, [item.catalog]))[0];
  }

  /** Renames, archives or restores a catalog. */
  async updateCatalog(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    expectedVersion: number,
    changes: { name?: string; archived?: boolean },
  ): Promise<CatalogView> {
    if (changes.name === undefined && changes.archived === undefined)
      throw new CatalogFailure("VALIDATION_FAILED");
    const name =
      changes.name === undefined ? undefined : catalogName(changes.name);
    const changed = await this.#withCatalog(
      context,
      companyId,
      catalogId,
      { mode: "update", capability: "catalogs.manage", expectedVersion },
      async ({ tx, catalog, actor }) => {
        if (catalog.status === "ARCHIVED" && changes.archived !== false)
          throw new CatalogFailure("CATALOG_ARCHIVED");
        const status: CatalogStatus | undefined =
          changes.archived === undefined
            ? undefined
            : changes.archived
              ? "ARCHIVED"
              : "ACTIVE";
        const updated = await this.#repository.updateCatalog(tx, catalog, {
          ...(name !== undefined ? { name } : {}),
          ...(status !== undefined ? { status } : {}),
        });
        const audit = (action: string, details: Record<string, unknown>) =>
          this.#repository.audit(
            tx,
            companyId,
            actor,
            { catalogId },
            [catalog.branchId],
            action,
            { ...details, version: updated.version },
          );
        if (name !== undefined && name !== catalog.name)
          await audit("catalog.renamed", { from: catalog.name, to: name });
        if (status !== undefined && status !== catalog.status)
          await audit(
            status === "ARCHIVED" ? "catalog.archived" : "catalog.restored",
            {},
          );
        return updated;
      },
    );
    return (await this.#catalogViews(companyId, [changed]))[0];
  }

  /** Deletes an empty catalog that no other catalog's field targets. */
  async deleteCatalog(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.#withCatalog(
      context,
      companyId,
      catalogId,
      { mode: "delete", capability: "catalogs.manage", expectedVersion },
      async ({ tx, catalog, actor }) => {
        const counts = await this.#repository.recordCounts(
          companyId,
          [catalogId],
          tx,
        );
        if ((counts.get(catalogId) ?? 0) > 0)
          throw new CatalogFailure("CATALOG_NOT_EMPTY");
        if (
          (await this.#repository.referencingFields(tx, companyId, catalogId)) >
            0 ||
          (await this.#usage(tx, companyId, catalogId)).layouts > 0
        )
          throw new CatalogFailure("CATALOG_IN_USE");
        await this.#repository.deleteCatalog(tx, catalog);
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId },
          [catalog.branchId],
          "catalog.deleted",
          { name: catalog.name },
        );
      },
    );
  }

  /** Replaces the whole ordered field list with the observed version. */
  async replaceSchema(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    expectedVersion: number,
    input: readonly FieldInput[],
  ): Promise<CatalogView> {
    const changed = await this.#withCatalog(
      context,
      companyId,
      catalogId,
      { mode: "update", capability: "catalogs.manage", expectedVersion },
      async ({ tx, access, catalog, actor }) => {
        requireWritable(catalog);
        const current =
          (await this.#repository.fields(companyId, [catalogId], tx)).get(
            catalogId,
          ) ?? [];
        const plan = planSchema(current, input, randomUUID);
        const issues = await this.#targetIssues(
          tx,
          access,
          catalog,
          plan.checks,
        );
        for (const check of plan.checks) {
          if (check.kind === "target") continue;
          const count = await this.#repository.countCheck(tx, catalog, check);
          if (count > 0) issues.push(schemaIssue(check, count));
        }
        // Fields a layout binds can be neither removed nor archived.
        const bound = (await this.#usage(tx, companyId, catalogId)).fields;
        for (const fieldId of plan.changes.removed) {
          const count = bound.get(fieldId) ?? 0;
          if (count > 0)
            issues.push({
              path: "/fields",
              reason: "FIELD_BOUND",
              fieldId,
              count,
            });
        }
        plan.fields.forEach((field, index) => {
          const count = bound.get(field.id) ?? 0;
          if (count > 0 && plan.changes.archived.includes(field.id))
            issues.push({
              path: `/fields/${index}/archived`,
              reason: "FIELD_BOUND",
              count,
            });
        });
        if (issues.length > 0)
          throw new CatalogFailure("CATALOG_SCHEMA_INVALID", issues);
        await this.#repository.replaceFields(
          tx,
          catalog,
          plan.fields,
          plan.changes.removed,
        );
        const updated = await this.#repository.updateCatalog(tx, catalog, {
          schema: true,
        });
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId },
          [catalog.branchId],
          "catalog.schema_changed",
          { ...plan.changes, schemaVersion: updated.schemaVersion },
        );
        return updated;
      },
    );
    return (await this.#catalogViews(companyId, [changed]))[0];
  }

  /** Reference targets must be active, visible and cover the catalog's scope. */
  async #targetIssues(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    owner: { companyId: string; branchId: string | null; id: string | null },
    checks: readonly SchemaCheck[],
  ): Promise<Issue[]> {
    const issues: Issue[] = [];
    for (const check of checks) {
      if (check.kind !== "target") continue;
      const target =
        check.catalogId === owner.id
          ? null
          : await this.#repository.lockCatalog(
              tx,
              owner.companyId,
              check.catalogId,
              "key",
            );
      const fits =
        check.catalogId === owner.id ||
        (target !== null &&
          target.status === "ACTIVE" &&
          catalogVisible(access, target) &&
          (target.branchId === null || target.branchId === owner.branchId));
      if (!fits)
        issues.push({
          path: `${check.path}/targetCatalogId`,
          reason: "TARGET_INVALID",
        });
    }
    return issues;
  }

  // Records

  async listRecords(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    query: RecordQuery,
  ): Promise<{ items: RecordView[]; nextCursor: string | null }> {
    const { access, catalog } = await this.#visibleCatalog(
      context,
      companyId,
      catalogId,
    );
    const fields =
      (await this.#repository.fields(companyId, [catalogId])).get(catalogId) ??
      [];
    const text = query.text?.trim() || undefined;
    const scope = [catalogId, text ?? ""].join("|");
    const cursor = decodeCursor(
      query.cursor,
      { company: companyId, principal: context.principalId, scope },
      // Positions are PostgreSQL integers; a larger forged one is invalid.
      (raw) => /^\d{1,10}$/.test(raw) && Number(raw) <= 2_147_483_647,
    );
    const textFields = fields
      .filter(
        (field) =>
          (field.type === "text" || field.type === "longText") &&
          !field.archived,
      )
      .map((field) => field.id);
    if (text && textFields.length === 0) return { items: [], nextCursor: null };
    const rows = await this.#repository.listRecords(catalog, {
      limit: query.limit + 1,
      ...(cursor
        ? { after: { position: Number(cursor.k), id: cursor.i } }
        : {}),
      ...(text ? { text: { pattern: text, fieldIds: textFields } } : {}),
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: await this.#recordViews(access, catalog, fields, page),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              r: scope,
              k: String(last.position),
              i: last.id,
            })
          : null,
    };
  }

  async getRecord(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
  ): Promise<RecordView> {
    const { access, catalog } = await this.#visibleCatalog(
      context,
      companyId,
      catalogId,
    );
    const found = await this.#repository.findRecord(
      companyId,
      catalogId,
      recordId,
    );
    if (!found) throw new CatalogFailure("RESOURCE_NOT_FOUND");
    return this.#recordView(access, catalog, found);
  }

  async createRecord(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    input: { values: Readonly<Record<string, unknown>>; available?: boolean },
  ): Promise<RecordView> {
    const { created, access, catalog } = await this.#withCatalog(
      context,
      companyId,
      catalogId,
      { mode: "update", capability: "catalogs.edit" },
      async ({ tx, access, catalog, actor }) => {
        requireWritable(catalog);
        const counts = await this.#repository.recordCounts(
          companyId,
          [catalogId],
          tx,
        );
        if ((counts.get(catalogId) ?? 0) >= catalogPolicy.maxRecordsPerCatalog)
          throw new CatalogFailure("CATALOG_LIMIT_REACHED");
        const fields =
          (await this.#repository.fields(companyId, [catalogId], tx)).get(
            catalogId,
          ) ?? [];
        const plan = planValues(fields, input.values, {});
        await this.#checkLinks(tx, access, catalog, fields, plan.values, {});
        const item = await this.#repository.createRecord(tx, actor, catalog, {
          values: plan.values,
          available: input.available ?? true,
        });
        await this.#repository.replaceLinks(
          tx,
          companyId,
          item,
          linksOf(fields, plan.values),
        );
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId: item.id },
          [catalog.branchId],
          "catalog.record_created",
          { fields: plan.changed, available: item.available },
        );
        return { created: item, access, catalog };
      },
    );
    return this.#recordView(access, catalog, created);
  }

  /** Replaces a record's editable values and/or its availability. */
  async updateRecord(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    expectedVersion: number,
    changes: {
      values?: Readonly<Record<string, unknown>>;
      available?: boolean;
    },
  ): Promise<RecordView> {
    if (changes.values === undefined && changes.available === undefined)
      throw new CatalogFailure("VALIDATION_FAILED");
    return this.#changeRecord(
      context,
      companyId,
      catalogId,
      recordId,
      expectedVersion,
      { mode: "share", capability: "catalogs.edit" },
      async ({ tx, access, catalog, actor }, current) => {
        const fields =
          (await this.#repository.fields(companyId, [catalogId], tx)).get(
            catalogId,
          ) ?? [];
        const plan =
          changes.values === undefined
            ? undefined
            : planValues(fields, changes.values, current.values);
        if (plan)
          await this.#checkLinks(
            tx,
            access,
            catalog,
            fields,
            plan.values,
            current.values,
          );
        const updated = await this.#repository.updateRecord(
          tx,
          actor,
          companyId,
          current,
          {
            ...(plan ? { values: plan.values } : {}),
            ...(changes.available !== undefined
              ? { available: changes.available }
              : {}),
          },
        );
        if (plan)
          await this.#repository.replaceLinks(
            tx,
            companyId,
            updated,
            linksOf(fields, plan.values),
          );
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId },
          [catalog.branchId],
          "catalog.record_updated",
          {
            fields: plan?.changed ?? [],
            ...(changes.available !== undefined &&
            changes.available !== current.available
              ? { available: changes.available }
              : {}),
            version: updated.version,
          },
        );
        return updated;
      },
    );
  }

  /** Places a record after another one, or first when `afterRecordId` is null. */
  async moveRecord(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    expectedVersion: number,
    afterRecordId: string | null,
  ): Promise<RecordView> {
    if (afterRecordId === recordId)
      throw new CatalogFailure("VALIDATION_FAILED");
    return this.#changeRecord(
      context,
      companyId,
      catalogId,
      recordId,
      expectedVersion,
      { mode: "update", capability: "catalogs.edit" },
      async ({ tx, catalog, actor }, current) => {
        let position = await this.#positionAfter(
          tx,
          catalog,
          afterRecordId,
          recordId,
        );
        if (position === null) {
          await this.#repository.renumber(tx, catalog, recordId);
          position = await this.#positionAfter(
            tx,
            catalog,
            afterRecordId,
            recordId,
          );
        }
        if (position === null) throw new Error("Record positions exhausted");
        const updated = await this.#repository.updateRecord(
          tx,
          actor,
          companyId,
          current,
          { position },
        );
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId },
          [catalog.branchId],
          "catalog.record_moved",
          { afterRecordId, version: updated.version },
        );
        return updated;
      },
    );
  }

  /** A free position between neighbors, or null when they are adjacent. */
  async #positionAfter(
    tx: Prisma.TransactionClient,
    catalog: CatalogData,
    afterRecordId: string | null,
    recordId: string,
  ): Promise<number | null> {
    const around = await this.#repository.neighbors(
      tx,
      catalog,
      afterRecordId,
      recordId,
    );
    if (!around) throw new CatalogFailure("RESOURCE_NOT_FOUND");
    const lower = around.lower ?? -1;
    const upper = around.upper ?? lower + 2 * positionGap;
    if (upper - lower < 2) return null;
    return lower + Math.floor((upper - lower) / 2);
  }

  async deleteRecord(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.#changeRecord(
      context,
      companyId,
      catalogId,
      recordId,
      expectedVersion,
      { mode: "share", capability: "catalogs.edit", lock: "delete" },
      async ({ tx, catalog, actor }, current) => {
        const referrers = await this.#repository.referrers(
          tx,
          companyId,
          recordId,
        );
        if (referrers > 0)
          throw new CatalogFailure("CATALOG_RECORD_REFERENCED", [
            { path: "", reason: "REFERRED_BY_RECORDS", count: referrers },
          ]);
        await this.#repository.deleteRecord(tx, companyId, current);
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId },
          [catalog.branchId],
          "catalog.record_deleted",
          {},
        );
        return current;
      },
      { view: false },
    );
  }

  /** New media must be selectable image items in scope; new references must exist. */
  async #checkLinks(
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    catalog: CatalogData,
    fields: readonly FieldDefinition[],
    values: Values,
    previous: Values,
  ): Promise<void> {
    const issues: Issue[] = [];
    for (const field of fields) {
      const value = values[field.id];
      if (typeof value !== "string" || value === previous[field.id]) continue;
      const path = `/values/${field.id}`;
      if (field.type === "media") {
        try {
          const [selected] = await this.#media.requireSelectable(tx, access, [
            value,
          ]);
          if (selected?.kind !== "IMAGE")
            issues.push({ path, reason: "MEDIA_NOT_IMAGE" });
          else if (
            selected.branchId !== null &&
            selected.branchId !== catalog.branchId
          )
            issues.push({ path, reason: "MEDIA_SCOPE" });
        } catch (error) {
          if (!(error instanceof MediaFailure)) throw error;
          issues.push({ path, reason: "MEDIA_UNAVAILABLE" });
        }
      }
      if (field.type === "reference" && field.targetCatalogId) {
        const found = await this.#repository.shareRecords(
          tx,
          catalog.companyId,
          field.targetCatalogId,
          [value],
        );
        if (!found.has(value))
          issues.push({ path, reason: "REFERENCE_NOT_FOUND" });
      }
    }
    if (issues.length > 0)
      throw new CatalogFailure("CATALOG_RECORD_INVALID", issues);
  }

  // Prices

  /** Sets or clears the base price of a money field. */
  async setBasePrice(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    fieldId: string,
    expectedVersion: number,
    amount: number | null,
  ): Promise<RecordView> {
    if (amount !== null && !isAmount(amount))
      throw new CatalogFailure("VALIDATION_FAILED");
    return this.#changeRecord(
      context,
      companyId,
      catalogId,
      recordId,
      expectedVersion,
      { mode: "share", capability: "prices.edit" },
      async (locked, current) => {
        const { tx, catalog, actor } = locked;
        const fields =
          (await this.#repository.fields(companyId, [catalogId], tx)).get(
            catalogId,
          ) ?? [];
        const field = moneyField(fields, fieldId);
        const old = current.values[fieldId];
        const values: Record<string, Values[string]> = { ...current.values };
        if (amount === null) delete values[fieldId];
        else values[fieldId] = amount;
        const updated = await this.#repository.updateRecord(
          tx,
          actor,
          companyId,
          current,
          { values },
        );
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId },
          [catalog.branchId],
          "catalog.price_changed",
          {
            fieldId,
            currency: field.currency,
            from: typeof old === "number" ? old : null,
            to: amount,
            version: updated.version,
          },
        );
        await this.#priceChanged(locked, null);
        return updated;
      },
    );
  }

  /** Sets or clears one branch's price of a company catalog's money field. */
  async setBranchPrice(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    fieldId: string,
    branchId: string,
    expectedVersion: number,
    amount: number | null,
  ): Promise<RecordView> {
    if (amount !== null && !isAmount(amount))
      throw new CatalogFailure("VALIDATION_FAILED");
    return this.#changeRecord(
      context,
      companyId,
      catalogId,
      recordId,
      expectedVersion,
      { mode: "share", capability: null, branchIds: [branchId] },
      async (locked, current) => {
        const { tx, access, activeBranchIds, catalog, actor } = locked;
        if (catalog.branchId !== null)
          throw new CatalogFailure("VALIDATION_FAILED");
        requireCapability(access, "prices.edit", branchId);
        if (amount !== null && !activeBranchIds.has(branchId))
          throw new CatalogFailure("VALIDATION_FAILED");
        const fields =
          (await this.#repository.fields(companyId, [catalogId], tx)).get(
            catalogId,
          ) ?? [];
        const field = moneyField(fields, fieldId);
        const old = (
          await this.#repository.overrides(companyId, [recordId], tx)
        ).find(
          (override) =>
            override.fieldId === fieldId && override.branchId === branchId,
        );
        await this.#repository.setOverride(
          tx,
          companyId,
          current,
          fieldId,
          branchId,
          amount,
        );
        const updated = await this.#repository.updateRecord(
          tx,
          actor,
          companyId,
          current,
          {},
        );
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId },
          [branchId],
          "catalog.price_override_changed",
          {
            fieldId,
            branchId,
            currency: field.currency,
            from: old?.amount ?? null,
            to: amount,
            version: updated.version,
          },
        );
        await this.#priceChanged(locked, branchId);
        return updated;
      },
    );
  }

  async listPromotions(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    fieldId: string,
  ): Promise<PromotionView[]> {
    const { access } = await this.#visibleCatalog(
      context,
      companyId,
      catalogId,
    );
    const fields =
      (await this.#repository.fields(companyId, [catalogId])).get(catalogId) ??
      [];
    moneyField(fields, fieldId);
    if (!(await this.#repository.findRecord(companyId, catalogId, recordId)))
      throw new CatalogFailure("RESOURCE_NOT_FOUND");
    const promotions = (
      await this.#repository.promotions(companyId, [recordId])
    ).filter(
      (promotion) =>
        promotion.fieldId === fieldId &&
        (promotion.branchId === null ||
          branchVisible(access, promotion.branchId)),
    );
    return this.#promotionViews(companyId, promotions);
  }

  /** Adds a promotion; overlapping windows with intersecting branches conflict. */
  async createPromotion(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    fieldId: string,
    input: {
      branchId: string | null;
      amount: number;
      startsAt: string;
      endsAt: string;
    },
  ): Promise<PromotionView> {
    if (
      !isAmount(input.amount) ||
      !isLocalMinute(input.startsAt) ||
      !isLocalMinute(input.endsAt) ||
      input.startsAt >= input.endsAt
    )
      throw new CatalogFailure("VALIDATION_FAILED");
    const result: { created?: PromotionData } = {};
    await this.#changeRecord(
      context,
      companyId,
      catalogId,
      recordId,
      undefined,
      {
        mode: "share",
        capability: null,
        branchIds: input.branchId ? [input.branchId] : [],
      },
      async (locked, current) => {
        const { tx, access, activeBranchIds, catalog, actor } = locked;
        this.#requirePromotionScope(access, catalog, input.branchId);
        if (input.branchId && !activeBranchIds.has(input.branchId))
          throw new CatalogFailure("VALIDATION_FAILED");
        const fields =
          (await this.#repository.fields(companyId, [catalogId], tx)).get(
            catalogId,
          ) ?? [];
        const field = moneyField(fields, fieldId);
        if (!field.promotions) throw new CatalogFailure("VALIDATION_FAILED");
        const existing = (
          await this.#repository.promotions(companyId, [recordId], tx)
        ).filter((promotion) => promotion.fieldId === fieldId);
        if (existing.length >= catalogPolicy.maxPromotionsPerPrice)
          throw new CatalogFailure("CATALOG_LIMIT_REACHED");
        if (existing.some((promotion) => promotionsConflict(promotion, input)))
          throw new CatalogFailure("CATALOG_PROMOTION_CONFLICT");
        const id = await this.#repository.createPromotion(
          tx,
          actor,
          companyId,
          current,
          { ...input, fieldId },
        );
        result.created = {
          id,
          recordId,
          fieldId,
          ...input,
          createdAt: new Date(),
        };
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId },
          [input.branchId ?? catalog.branchId],
          "catalog.promotion_changed",
          {
            change: "created",
            promotionId: id,
            fieldId,
            branchId: input.branchId,
            currency: field.currency,
            amount: input.amount,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
        );
        await this.#priceChanged(locked, input.branchId);
        return current;
      },
      { view: false },
    );
    if (!result.created) throw new Error("Promotion was not created");
    return (await this.#promotionViews(companyId, [result.created]))[0];
  }

  async deletePromotion(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    fieldId: string,
    promotionId: string,
  ): Promise<void> {
    const before = (
      await this.#repository.promotions(companyId, [recordId])
    ).find(
      (promotion) =>
        promotion.id === promotionId && promotion.fieldId === fieldId,
    );
    if (!before) throw new CatalogFailure("RESOURCE_NOT_FOUND");
    await this.#changeRecord(
      context,
      companyId,
      catalogId,
      recordId,
      undefined,
      {
        mode: "share",
        capability: null,
        branchIds: before.branchId ? [before.branchId] : [],
      },
      async (locked, current) => {
        const { tx, access, catalog, actor } = locked;
        const promotion = (
          await this.#repository.promotions(companyId, [recordId], tx)
        ).find(
          (candidate) =>
            candidate.id === promotionId && candidate.fieldId === fieldId,
        );
        if (
          !promotion ||
          (promotion.branchId !== null &&
            !branchVisible(access, promotion.branchId))
        )
          throw new CatalogFailure("RESOURCE_NOT_FOUND");
        this.#requirePromotionScope(access, catalog, promotion.branchId);
        const fields =
          (await this.#repository.fields(companyId, [catalogId], tx)).get(
            catalogId,
          ) ?? [];
        const field = fields.find((candidate) => candidate.id === fieldId);
        await this.#repository.deletePromotion(tx, companyId, promotionId);
        await this.#repository.audit(
          tx,
          companyId,
          actor,
          { catalogId, recordId },
          [promotion.branchId ?? catalog.branchId],
          "catalog.promotion_changed",
          {
            change: "deleted",
            promotionId,
            fieldId,
            branchId: promotion.branchId,
            currency: field?.currency ?? null,
            amount: promotion.amount,
            startsAt: promotion.startsAt,
            endsAt: promotion.endsAt,
          },
        );
        await this.#priceChanged(locked, promotion.branchId);
        return current;
      },
      { view: false },
    );
  }

  /** Scope-wide promotions need the catalog's scope; branch ones that branch. */
  #requirePromotionScope(
    access: CompanyAccess,
    catalog: CatalogData,
    branchId: string | null,
  ): void {
    if (branchId === null)
      requireCapability(access, "prices.edit", catalog.branchId ?? undefined);
    else if (catalog.branchId !== null)
      throw new CatalogFailure("VALIDATION_FAILED");
    else requireCapability(access, "prices.edit", branchId);
  }

  /**
   * The price of each active money field at a local minute: for the whole
   * scope, and for each visible branch with its own override or promotion.
   */
  async effectivePrices(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    at: string,
  ): Promise<EffectivePricesView> {
    if (!isLocalMinute(at)) throw new CatalogFailure("VALIDATION_FAILED");
    const { access, catalog } = await this.#visibleCatalog(
      context,
      companyId,
      catalogId,
    );
    const found = await this.#repository.findRecord(
      companyId,
      catalogId,
      recordId,
    );
    if (!found) throw new CatalogFailure("RESOURCE_NOT_FOUND");
    const fields = (
      (await this.#repository.fields(companyId, [catalogId])).get(catalogId) ??
      []
    ).filter((field) => field.type === "money" && !field.archived);
    const overrides = (
      await this.#repository.overrides(companyId, [recordId])
    ).filter((override) => branchVisible(access, override.branchId));
    const promotions = (
      await this.#repository.promotions(companyId, [recordId])
    ).filter(
      (promotion) =>
        promotion.branchId === null ||
        branchVisible(access, promotion.branchId),
    );
    const names = await this.#branchNames(companyId, [
      ...overrides.map((override) => override.branchId),
      ...promotions.flatMap((promotion) =>
        promotion.branchId ? [promotion.branchId] : [],
      ),
    ]);
    return {
      at,
      fields: fields.map((field) => {
        const base = found.values[field.id];
        const facts = {
          base: typeof base === "number" ? base : null,
          overrides: new Map(
            overrides
              .filter((override) => override.fieldId === field.id)
              .map((override) => [override.branchId, override.amount]),
          ),
          promotions: promotions.filter(
            (promotion) => promotion.fieldId === field.id,
          ),
        };
        const branches = [
          ...new Set([
            ...facts.overrides.keys(),
            ...facts.promotions.flatMap((promotion) =>
              promotion.branchId ? [promotion.branchId] : [],
            ),
          ]),
        ].sort();
        return {
          fieldId: field.id,
          currency: field.currency ?? "",
          scope: effectivePrice(facts, catalog.branchId, at),
          branches: branches.map((branchId) => ({
            branchId,
            branchName: names.get(branchId) ?? "",
            ...effectivePrice(facts, branchId, at),
          })),
        };
      }),
    };
  }

  // Catalog port

  /** Active catalogs visible to the access, key-share-locked. */
  requireBindable = async (
    tx: Prisma.TransactionClient,
    access: CompanyAccess,
    catalogIds: readonly string[],
  ): Promise<BindableCatalog[]> => {
    const found = (
      await this.#repository.keyShareCatalogs(tx, access.companyId, catalogIds)
    ).filter(
      (catalog) =>
        catalog.status === "ACTIVE" && catalogVisible(access, catalog),
    );
    return this.#bindable(access.companyId, found, tx);
  };

  describeCatalogs = async (
    companyId: string,
    catalogIds: readonly string[],
  ): Promise<BindableCatalog[]> =>
    this.#bindable(
      companyId,
      await this.#repository.findCatalogs(companyId, catalogIds),
    );

  visibleCatalog = async (
    access: CompanyAccess,
    catalogId: string,
  ): Promise<BindableCatalog | null> => {
    const item = await this.#repository.findCatalog(
      access.companyId,
      catalogId,
    );
    if (!item || !catalogVisible(access, item)) return null;
    return (await this.#bindable(access.companyId, [item]))[0] ?? null;
  };

  priceSequences = async (
    tx: Prisma.TransactionClient,
    companyId: string,
    catalogIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>> =>
    new Map(
      await Promise.all(
        [...new Set(catalogIds)].map(
          async (id) =>
            [
              id,
              await this.#repository.priceSequence(companyId, id, tx),
            ] as const,
        ),
      ),
    );

  // One repeatable-read snapshot, so a concurrent save never mixes states.
  viewData = (
    companyId: string,
    catalogId: string,
  ): Promise<CatalogViewData | null> =>
    this.#repository.snapshot(async (tx) => {
      const [catalog] = await this.#bindable(
        companyId,
        await this.#repository.findCatalogs(companyId, [catalogId], tx),
        tx,
      );
      if (!catalog) return null;
      const priceSequence = await this.#repository.priceSequence(
        companyId,
        catalogId,
        tx,
      );
      const records = await this.#repository.allRecords(
        companyId,
        catalogId,
        tx,
      );
      const prices = new Map<
        string,
        Map<
          string,
          {
            base: number | null;
            overrides: Map<string, number>;
            promotions: Promotion[];
          }
        >
      >();
      const money = catalog.fields.filter((field) => field.type === "money");
      for (const record of records)
        prices.set(
          record.id,
          new Map(
            money.map((field) => {
              const base = record.values[field.id];
              return [
                field.id,
                {
                  base: typeof base === "number" ? base : null,
                  overrides: new Map<string, number>(),
                  promotions: [],
                },
              ];
            }),
          ),
        );
      for (const override of await this.#repository.catalogOverrides(
        companyId,
        catalogId,
        tx,
      ))
        prices
          .get(override.recordId)
          ?.get(override.fieldId)
          ?.overrides.set(override.branchId, override.amount);
      for (const promotion of await this.#repository.catalogPromotions(
        companyId,
        catalogId,
        tx,
      ))
        prices
          .get(promotion.recordId)
          ?.get(promotion.fieldId)
          ?.promotions.push(promotion);
      const references = catalog.fields.filter(
        (field) => field.type === "reference",
      );
      const referenced = records.flatMap((record) =>
        references.flatMap((field) => {
          const value = record.values[field.id];
          return typeof value === "string" ? [value] : [];
        }),
      );
      return {
        catalog,
        priceSequence,
        records: records.map((record) => ({
          id: record.id,
          available: record.available,
          values: record.values,
        })),
        prices,
        referenceTitles: await this.#repository.titles(
          companyId,
          [...new Set(referenced)],
          tx,
        ),
      };
    });

  async #bindable(
    companyId: string,
    catalogs: readonly CatalogData[],
    tx?: Prisma.TransactionClient,
  ): Promise<BindableCatalog[]> {
    const fields = await this.#repository.fields(
      companyId,
      catalogs.map((catalog) => catalog.id),
      tx,
    );
    return catalogs.map((catalog) => ({
      id: catalog.id,
      name: catalog.name,
      branchId: catalog.branchId,
      status: catalog.status,
      fields: (fields.get(catalog.id) ?? []).map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        archived: field.archived,
        choices: field.choices ?? [],
        currency: field.currency ?? null,
      })),
    }));
  }

  /** Media reference guard: record values protect their media. */
  mediaReferences = async (
    tx: Prisma.TransactionClient,
    companyId: string,
    assetId: string,
  ) =>
    (await this.#repository.recordsUsingMedia(tx, companyId, assetId)).map(
      (row) => ({ kind: "catalog-record", branchId: row.branchId }),
    );

  // Shared steps

  async #visibleCatalog(
    context: HumanContext,
    companyId: string,
    catalogId: string,
  ): Promise<{ access: CompanyAccess; catalog: CatalogData }> {
    const access = await this.#companies.resolve(context, companyId);
    requireActive(access);
    const item = await this.#repository.findCatalog(companyId, catalogId);
    if (!item || !catalogVisible(access, item))
      throw new CatalogFailure("RESOURCE_NOT_FOUND");
    return { access, catalog: item };
  }

  /**
   * Runs a catalog write: organization locks (the catalog's branch and any
   * named ones), then the catalog row in the given mode, the access check
   * and the version check.
   */
  async #withCatalog<T>(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    options: {
      mode: "update" | "share" | "delete";
      capability: Capability | null;
      expectedVersion?: number;
      branchIds?: readonly string[];
    },
    work: (locked: Locked) => Promise<T>,
  ): Promise<T> {
    const before = await this.#repository.findCatalog(companyId, catalogId);
    if (!before) throw new CatalogFailure("RESOURCE_NOT_FOUND");
    return this.#repository.transaction(async (tx) => {
      const locked = await this.#companies.lockForWrite(
        tx,
        context,
        companyId,
        [
          ...(before.branchId ? [before.branchId] : []),
          ...(options.branchIds ?? []),
        ],
      );
      const current = await this.#repository.lockCatalog(
        tx,
        companyId,
        catalogId,
        options.mode,
      );
      if (!current) throw new CatalogFailure("RESOURCE_NOT_FOUND");
      // Branch price and promotion operations check their branch's
      // capability themselves once the catalog is visible.
      if (options.capability)
        requireCatalog(locked.access, options.capability, current);
      else {
        requireActive(locked.access);
        if (!catalogVisible(locked.access, current))
          throw new CatalogFailure("RESOURCE_NOT_FOUND");
      }
      if (
        options.expectedVersion !== undefined &&
        current.version !== options.expectedVersion
      )
        throw new CatalogFailure("RESOURCE_VERSION_CONFLICT");
      return work({
        tx,
        access: locked.access,
        activeBranchIds: locked.activeBranchIds,
        catalog: current,
        actor: actorOf(context, locked.access),
      });
    });
  }

  /**
   * Runs a record write inside #withCatalog: the catalog must be active,
   * then the record row is locked and its version checked when given.
   */
  async #changeRecord(
    context: HumanContext,
    companyId: string,
    catalogId: string,
    recordId: string,
    expectedVersion: number | undefined,
    options: {
      mode: "update" | "share";
      capability: Capability | null;
      branchIds?: readonly string[];
      lock?: "update" | "delete";
    },
    change: (locked: Locked, current: RecordData) => Promise<RecordData>,
    view: { view?: boolean } = {},
  ): Promise<RecordView> {
    const result = await this.#withCatalog(
      context,
      companyId,
      catalogId,
      options,
      async (locked) => {
        requireWritable(locked.catalog);
        const current = await this.#repository.lockRecord(
          locked.tx,
          companyId,
          catalogId,
          recordId,
          options.lock ?? "update",
        );
        if (!current) throw new CatalogFailure("RESOURCE_NOT_FOUND");
        if (
          expectedVersion !== undefined &&
          current.version !== expectedVersion
        )
          throw new CatalogFailure("RESOURCE_VERSION_CONFLICT");
        return {
          changed: await change(locked, current),
          access: locked.access,
          catalog: locked.catalog,
        };
      },
    );
    if (view.view === false)
      return {
        ...result.changed,
        title: null,
        overrides: [],
        media: [],
        references: [],
      };
    return this.#recordView(result.access, result.catalog, result.changed);
  }

  async #branchNames(
    companyId: string,
    branchIds: readonly string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(branchIds)];
    if (unique.length === 0) return new Map();
    const described = await this.#companies.describe(companyId, unique);
    return new Map(
      [...described.branches].map(([id, branch]) => [id, branch.name]),
    );
  }

  async #catalogViews(
    companyId: string,
    items: readonly CatalogData[],
  ): Promise<CatalogView[]> {
    const ids = items.map((item) => item.id);
    const [fields, counts, names] = await Promise.all([
      this.#repository.fields(companyId, ids),
      this.#repository.recordCounts(companyId, ids),
      this.#branchNames(
        companyId,
        items.flatMap((item) => (item.branchId ? [item.branchId] : [])),
      ),
    ]);
    return items.map((item) => ({
      ...item,
      branchName: item.branchId ? (names.get(item.branchId) ?? null) : null,
      fields: fields.get(item.id) ?? [],
      recordCount: counts.get(item.id) ?? 0,
    }));
  }

  async #recordView(
    access: CompanyAccess,
    catalog: CatalogData,
    item: RecordData,
  ): Promise<RecordView> {
    const fields =
      (await this.#repository.fields(catalog.companyId, [catalog.id])).get(
        catalog.id,
      ) ?? [];
    return (await this.#recordViews(access, catalog, fields, [item]))[0];
  }

  async #recordViews(
    access: CompanyAccess,
    catalog: CatalogData,
    fields: readonly FieldDefinition[],
    items: readonly RecordData[],
  ): Promise<RecordView[]> {
    const companyId = catalog.companyId;
    const overrides = (
      await this.#repository.overrides(
        companyId,
        items.map((item) => item.id),
      )
    ).filter((override) => branchVisible(access, override.branchId));
    const links = new Map(
      items.map((item) => [item.id, linksOf(fields, item.values)]),
    );
    const mediaIds = [...links.values()].flatMap((link) => [
      ...link.media.values(),
    ]);
    const referenceIds = [...links.values()].flatMap((link) => [
      ...link.references.values(),
    ]);
    const [names, media, titles] = await Promise.all([
      this.#branchNames(
        companyId,
        overrides.map((override) => override.branchId),
      ),
      mediaIds.length > 0
        ? this.#media.describe(companyId, [...new Set(mediaIds)])
        : Promise.resolve([]),
      this.#repository.titles(companyId, [...new Set(referenceIds)]),
    ]);
    const facts = new Map(media.map((fact) => [fact.id, fact]));
    const title = titleField(fields);
    return items.map((item) => {
      const link = links.get(item.id) ?? {
        media: new Map<string, string>(),
        references: new Map<string, string>(),
      };
      const titleValue = title ? item.values[title.id] : undefined;
      return {
        ...item,
        title: typeof titleValue === "string" ? titleValue : null,
        overrides: overrides
          .filter((override) => override.recordId === item.id)
          .map((override) => ({
            fieldId: override.fieldId,
            branchId: override.branchId,
            branchName: names.get(override.branchId) ?? "",
            amount: override.amount,
          })),
        media: [...link.media].map(([fieldId, mediaAssetId]) => ({
          fieldId,
          mediaAssetId,
          name: facts.get(mediaAssetId)?.name ?? null,
          status: facts.get(mediaAssetId)?.status ?? null,
        })),
        references: [...link.references].map(([fieldId, recordId]) => ({
          fieldId,
          recordId,
          title: titles.get(recordId) ?? null,
        })),
      };
    });
  }

  async #promotionViews(
    companyId: string,
    promotions: readonly PromotionData[],
  ): Promise<PromotionView[]> {
    const names = await this.#branchNames(
      companyId,
      promotions.flatMap((promotion) =>
        promotion.branchId ? [promotion.branchId] : [],
      ),
    );
    return promotions.map((promotion) => ({
      ...promotion,
      branchName: promotion.branchId
        ? (names.get(promotion.branchId) ?? null)
        : null,
    }));
  }
}

/** The issue a failing data-dependent schema check reports. */
function schemaIssue(
  check: Exclude<SchemaCheck, { kind: "target" }>,
  count: number,
): Issue {
  switch (check.kind) {
    case "removed":
      return {
        path: "/fields",
        reason: "FIELD_HAS_VALUES",
        fieldId: check.fieldId,
        count,
      };
    case "missing":
      return {
        path: `${check.path}/required`,
        reason: "REQUIRED_MISSING_VALUES",
        count,
      };
    case "tooLong":
      return {
        path: `${check.path}/maxLength`,
        reason: "VALUES_TOO_LONG",
        count,
      };
    case "outOfRange":
      return { path: check.path, reason: "VALUES_OUT_OF_RANGE", count };
    case "choices":
      return { path: `${check.path}/choices`, reason: "CHOICE_IN_USE", count };
    case "promotions":
      return {
        path: `${check.path}/promotions`,
        reason: "PROMOTIONS_EXIST",
        count,
      };
  }
}
