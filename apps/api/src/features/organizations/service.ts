import { createHash } from "node:crypto";
import type { HumanContext } from "../identity/public.js";
import {
  branchReach,
  companyAccess,
  decide,
  isTimeZone,
  normalizeName,
  OrganizationFailure,
  reachableWithStrongAuthentication,
  requireCapability,
  type AccessRole,
  type BranchStatus,
  type Capability,
  type CompanyAccess,
  type Locale,
} from "./domain.js";
import type {
  AuditRecord,
  BranchRecord,
  CompanyRecord,
  PrismaOrganizationRepository,
} from "./prisma-repository.js";

const capabilities: readonly Capability[] = [
  "company.view",
  "company.settings.manage",
  "branches.view",
  "branches.manage",
  "audit.view",
];

export type AccessSummary = Readonly<{
  roles: AccessRole[];
  responsible: boolean;
  /** Capabilities usable in the current session. */
  capabilities: Capability[];
  /** Capabilities that two-step verification would make usable. */
  capabilitiesAfterStrongAuthentication: Capability[];
}>;

type Cursor = Record<string, string>;

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function branchScope(reach: "all" | ReadonlySet<string>): string {
  return reach === "all"
    ? "all"
    : createHash("sha256")
        .update([...reach].sort().join(","))
        .digest("base64url");
}

/** Cursors are bound to the company and principal that received them. */
function decodeCursor(
  value: string | undefined,
  binding: {
    company: string;
    principal: string;
    kind: "branches" | "audit";
    scope: string;
  },
): Cursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error("Invalid cursor encoding");
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((field) => typeof field === "string") &&
      (parsed as Cursor).c === binding.company &&
      (parsed as Cursor).p === binding.principal &&
      (parsed as Cursor).k === binding.kind &&
      (parsed as Cursor).r === binding.scope
    ) {
      const cursor = parsed as Cursor;
      const validId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          cursor.i ?? "",
        );
      if (
        validId &&
        (binding.kind === "branches"
          ? (cursor.s === "ACTIVE" || cursor.s === "ARCHIVED") &&
            typeof cursor.n === "string" &&
            cursor.n.length > 0 &&
            cursor.n.length <= 120
          : typeof cursor.t === "string" &&
            new Date(cursor.t).toISOString() === cursor.t)
      )
        return cursor;
    }
  } catch {
    /* Invalid cursors are rejected below. */
  }
  throw new OrganizationFailure("VALIDATION_FAILED");
}

function validName(value: string): string {
  const name = normalizeName(value);
  if (name.length === 0 || name.length > 120)
    throw new OrganizationFailure("VALIDATION_FAILED");
  return name;
}

function validTimeZone(value: string): string {
  if (!isTimeZone(value)) throw new OrganizationFailure("VALIDATION_FAILED");
  return value;
}

/** Application operations; every one resolves current access first. */
export class OrganizationService {
  readonly #repository: PrismaOrganizationRepository;

  constructor(repository: PrismaOrganizationRepository) {
    this.#repository = repository;
  }

  /** Resolves current access, hiding companies the principal is not in. */
  async access(
    context: HumanContext,
    companyId: string,
  ): Promise<CompanyAccess> {
    const membership = await this.#repository.resolveMembership(
      context.principalId,
      companyId,
    );
    if (!membership) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    return companyAccess({
      ...membership,
      principalId: context.principalId,
      strong: context.strongAuthenticationAgeSeconds !== null,
    });
  }

  summarize(access: CompanyAccess): AccessSummary {
    const usable = (capability: Capability) => {
      const reach = branchReach(access, capability);
      return reach === "all" || reach.size > 0;
    };
    return {
      roles: [...new Set(access.grants.map((grant) => grant.role))].sort(),
      responsible: access.responsible,
      capabilities: capabilities.filter(usable),
      capabilitiesAfterStrongAuthentication: capabilities.filter(
        (capability) =>
          !usable(capability) &&
          reachableWithStrongAuthentication(access, capability),
      ),
    };
  }

  async createCompany(
    context: HumanContext,
    creationKey: string,
    input: { displayName: string; defaultLocale: Locale; timeZone: string },
  ): Promise<{
    company: CompanyRecord;
    access: AccessSummary;
    replayed: boolean;
  }> {
    const created = await this.#repository.createCompany({
      principalId: context.principalId,
      creationKey,
      displayName: validName(input.displayName),
      defaultLocale: input.defaultLocale,
      timeZone: validTimeZone(input.timeZone),
    });
    const access = await this.access(context, created.company.id);
    return { ...created, access: this.summarize(access) };
  }

  async listCompanies(context: HumanContext) {
    return this.#repository.listCompanies(context.principalId);
  }

  async getCompany(
    context: HumanContext,
    companyId: string,
  ): Promise<{ company: CompanyRecord; access: AccessSummary }> {
    const access = await this.access(context, companyId);
    requireCapability(access, "company.view");
    const company = await this.#repository.findCompany(companyId);
    if (!company) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    return { company, access: this.summarize(access) };
  }

  async updateCompany(
    context: HumanContext,
    companyId: string,
    expectedVersion: number,
    changes: {
      displayName?: string;
      defaultLocale?: Locale;
      timeZone?: string;
    },
  ): Promise<CompanyRecord> {
    const access = await this.access(context, companyId);
    requireCapability(access, "company.settings.manage");
    const valid: typeof changes = {};
    if (changes.displayName !== undefined)
      valid.displayName = validName(changes.displayName);
    if (changes.timeZone !== undefined)
      valid.timeZone = validTimeZone(changes.timeZone);
    if (changes.defaultLocale !== undefined)
      valid.defaultLocale = changes.defaultLocale;
    if (Object.keys(valid).length === 0)
      throw new OrganizationFailure("VALIDATION_FAILED");
    return this.#repository.updateCompany(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      expectedVersion,
      valid,
    );
  }

  async listBranches(
    context: HumanContext,
    companyId: string,
    options: { limit: number; cursor?: string },
  ): Promise<{ items: BranchRecord[]; nextCursor: string | null }> {
    const access = await this.access(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const reach = branchReach(access, "branches.view");
    if (reach !== "all" && reach.size === 0) {
      if (reachableWithStrongAuthentication(access, "branches.view"))
        throw new OrganizationFailure("STRONG_AUTHENTICATION_REQUIRED");
      throw new OrganizationFailure("PERMISSION_DENIED");
    }
    const cursor = decodeCursor(options.cursor, {
      company: companyId,
      principal: context.principalId,
      kind: "branches",
      scope: branchScope(reach),
    });
    const items = await this.#repository.listBranches(companyId, reach, {
      limit: options.limit + 1,
      ...(cursor
        ? {
            after: {
              status: cursor.s as BranchStatus,
              name: cursor.n,
              id: cursor.i,
            },
          }
        : {}),
    });
    const page = items.slice(0, options.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        items.length > options.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              k: "branches",
              r: branchScope(reach),
              s: last.status,
              n: last.name,
              i: last.id,
            })
          : null,
    };
  }

  async getBranch(
    context: HumanContext,
    companyId: string,
    branchId: string,
  ): Promise<BranchRecord> {
    const access = await this.access(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const decision = decide(access, "branches.view", branchId);
    // A branch outside the caller's scope is indistinguishable from an absent one.
    if (decision === "strong_required")
      throw new OrganizationFailure("STRONG_AUTHENTICATION_REQUIRED");
    if (decision === "deny")
      throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    const found = await this.#repository.findBranch(companyId, branchId);
    if (!found) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    return found;
  }

  async createBranch(
    context: HumanContext,
    companyId: string,
    input: { name: string; timeZone?: string },
  ): Promise<BranchRecord> {
    const access = await this.access(context, companyId);
    requireCapability(access, "branches.manage");
    const timeZone =
      input.timeZone === undefined
        ? (await this.#repository.findCompany(companyId))!.timeZone
        : validTimeZone(input.timeZone);
    return this.#repository.createBranch(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      { name: validName(input.name), timeZone },
    );
  }

  async updateBranch(
    context: HumanContext,
    companyId: string,
    branchId: string,
    expectedVersion: number,
    changes: { name?: string; timeZone?: string; archive?: true },
  ): Promise<BranchRecord> {
    const access = await this.access(context, companyId);
    requireCapability(access, "branches.manage", branchId);
    const valid: typeof changes = {};
    if (changes.name !== undefined) valid.name = validName(changes.name);
    if (changes.timeZone !== undefined)
      valid.timeZone = validTimeZone(changes.timeZone);
    if (changes.archive) valid.archive = true;
    if (Object.keys(valid).length === 0)
      throw new OrganizationFailure("VALIDATION_FAILED");
    return this.#repository.updateBranch(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      branchId,
      expectedVersion,
      valid,
    );
  }

  async listAuditEvents(
    context: HumanContext,
    companyId: string,
    options: { limit: number; cursor?: string },
  ): Promise<{ items: AuditRecord[]; nextCursor: string | null }> {
    const access = await this.access(context, companyId);
    requireCapability(access, "audit.view");
    const cursor = decodeCursor(options.cursor, {
      company: companyId,
      principal: context.principalId,
      kind: "audit",
      scope: "company",
    });
    const items = await this.#repository.listAuditEvents(companyId, {
      limit: options.limit + 1,
      ...(cursor
        ? { before: { occurredAt: new Date(cursor.t), id: cursor.i } }
        : {}),
    });
    const page = items.slice(0, options.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        items.length > options.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              k: "audit",
              r: "company",
              t: last.occurredAt.toISOString(),
              i: last.id,
            })
          : null,
    };
  }
}
