import { createHash } from "node:crypto";
import type { HumanContext, HumanProfilePort } from "../identity/public.js";
import {
  branchReach,
  companyAccess,
  decide,
  grantRequest,
  isTimeZone,
  normalizeName,
  OrganizationFailure,
  reachableWithStrongAuthentication,
  requireCapability,
  type AccessRole,
  type BranchStatus,
  type Capability,
  type CompanyAccess,
  type GrantScopeName,
  type Locale,
  type MembershipStatus,
} from "./domain.js";
import type {
  AuditRecord,
  BranchRecord,
  CompanyRecord,
  GrantRecord,
  PrismaOrganizationRepository,
} from "./prisma-repository.js";

/** A pending responsibility transfer as seen by one of its two parties. */
export type TransferView = Readonly<{
  id: string;
  direction: "outgoing" | "incoming";
  fromMembershipId: string;
  toMembershipId: string;
  counterpartName: string | null;
  counterpartEmail: string | null;
  createdAt: Date;
  expiresAt: Date;
}>;

const capabilities: readonly Capability[] = [
  "company.view",
  "company.settings.manage",
  "branches.view",
  "branches.manage",
  "members.manage",
  "invitations.manage",
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

export function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function branchScope(reach: "all" | ReadonlySet<string>): string {
  return reach === "all"
    ? "all"
    : createHash("sha256")
        .update([...reach].sort().join(","))
        .digest("base64url");
}

/** Cursors are bound to their collection, principal and applicable tenant scope. */
export function decodeCursor(
  value: string | undefined,
  binding: {
    company: string;
    principal: string;
    kind: "companies" | "branches" | "audit" | "members" | "invitations";
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
        (binding.kind === "members"
          ? true
          : binding.kind === "branches"
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

function grantWire(grant: GrantRecord) {
  return {
    ...grant,
    startsAt: grant.startsAt.toISOString(),
    expiresAt: grant.expiresAt?.toISOString() ?? null,
  };
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
  readonly #profiles: HumanProfilePort;

  constructor(
    repository: PrismaOrganizationRepository,
    profiles: HumanProfilePort,
  ) {
    this.#repository = repository;
    this.#profiles = profiles;
  }

  async listMembers(
    context: HumanContext,
    companyId: string,
    options: { limit: number; cursor?: string },
  ) {
    const access = await this.access(context, companyId);
    requireCapability(access, "members.manage");
    const cursor = decodeCursor(options.cursor, {
      company: companyId,
      principal: context.principalId,
      kind: "members",
      scope: "company",
    });
    const rows = await this.#repository.listMembers(companyId, {
      limit: options.limit + 1,
      ...(cursor ? { after: cursor.i } : {}),
    });
    const items = rows.slice(0, options.limit);
    // Only IDs selected through this company's authorized membership page may
    // cross into identity's presentation port; there is no global directory API.
    const profiles = new Map(
      (
        await this.#profiles.getMany(items.map((member) => member.principalId))
      ).map((profile) => [profile.principalId, profile]),
    );
    const last = items.at(-1);
    return {
      items: items.map((member) => ({
        ...member,
        grants: member.grants.map(grantWire),
        displayName: profiles.get(member.principalId)?.displayName ?? null,
        email: profiles.get(member.principalId)?.email ?? null,
      })),
      nextCursor:
        rows.length > options.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              k: "members",
              r: "company",
              i: last.id,
            })
          : null,
    };
  }

  async updateMemberStatus(
    context: HumanContext,
    companyId: string,
    memberId: string,
    expectedVersion: number,
    status: MembershipStatus,
  ) {
    const access = await this.access(context, companyId);
    requireCapability(access, "members.manage");
    await this.#repository.updateMemberStatus(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      memberId,
      expectedVersion,
      status,
      context.strongAuthenticatedAt,
    );
  }

  async addGrant(
    context: HumanContext,
    companyId: string,
    memberId: string,
    input: {
      role: AccessRole;
      scope: GrantScopeName;
      branchIds?: string[];
      expiresAt?: string;
    },
  ) {
    const access = await this.access(context, companyId);
    requireCapability(access, "members.manage");
    const request = grantRequest(input);
    const expiresAt =
      input.expiresAt === undefined ? null : new Date(input.expiresAt);
    if (expiresAt && Number.isNaN(expiresAt.getTime()))
      throw new OrganizationFailure("VALIDATION_FAILED");
    const result = await this.#repository.addGrant(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      memberId,
      { ...request, expiresAt },
      context.strongAuthenticatedAt,
    );
    return { grant: grantWire(result.grant), created: result.created };
  }

  async revokeGrant(
    context: HumanContext,
    companyId: string,
    memberId: string,
    grantId: string,
  ): Promise<void> {
    const access = await this.access(context, companyId);
    requireCapability(access, "members.manage");
    await this.#repository.revokeGrant(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      memberId,
      grantId,
    );
  }

  /** The caller's pending transfer, with the other party's presentation data. */
  async transferView(access: CompanyAccess): Promise<TransferView | null> {
    const transfer = await this.#repository.currentTransfer(
      access.companyId,
      access.membershipId,
    );
    if (!transfer) return null;
    const outgoing = transfer.fromMembershipId === access.membershipId;
    const [profile] = await this.#profiles.getMany([
      outgoing ? transfer.toPrincipalId : transfer.fromPrincipalId,
    ]);
    return {
      id: transfer.id,
      direction: outgoing ? "outgoing" : "incoming",
      fromMembershipId: transfer.fromMembershipId,
      toMembershipId: transfer.toMembershipId,
      counterpartName: profile?.displayName ?? null,
      counterpartEmail: profile?.email ?? null,
      createdAt: transfer.createdAt,
      expiresAt: transfer.expiresAt,
    };
  }

  async requestResponsibilityTransfer(
    context: HumanContext,
    companyId: string,
    successorMembershipId: string,
  ): Promise<TransferView> {
    const access = await this.access(context, companyId);
    requireCapability(access, "members.manage");
    await this.#repository.requestTransfer(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      successorMembershipId,
      context.strongAuthenticatedAt,
    );
    const view = await this.transferView(access);
    if (!view) throw new Error("Requested transfer is not readable");
    return view;
  }

  async acceptResponsibilityTransfer(
    context: HumanContext,
    companyId: string,
    transferId: string,
  ): Promise<void> {
    const access = await this.access(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    // Only a current administrator can become responsible (P10).
    const decision = decide(access, "members.manage");
    if (decision === "strong_required")
      throw new OrganizationFailure("STRONG_AUTHENTICATION_REQUIRED");
    if (decision === "deny") {
      const transfer = await this.#repository.currentTransfer(
        companyId,
        access.membershipId,
      );
      throw new OrganizationFailure(
        transfer?.id === transferId &&
          transfer.toMembershipId === access.membershipId
          ? "SUCCESSOR_NOT_ELIGIBLE"
          : "RESOURCE_NOT_FOUND",
      );
    }
    await this.#repository.acceptTransfer(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      transferId,
      context.strongAuthenticatedAt,
    );
  }

  /** The proposer cancels, or the successor declines; either needs only membership. */
  async closeResponsibilityTransfer(
    context: HumanContext,
    companyId: string,
    transferId: string,
  ): Promise<void> {
    const access = await this.access(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    await this.#repository.closeTransfer(
      { principalId: context.principalId, membershipId: access.membershipId },
      companyId,
      transferId,
    );
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
    responsibilityTransfer: TransferView | null;
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
    return {
      ...created,
      access: this.summarize(access),
      responsibilityTransfer: await this.transferView(access),
    };
  }

  async listCompanies(
    context: HumanContext,
    options: { limit: number; cursor?: string },
  ) {
    const binding = {
      company: "",
      principal: context.principalId,
      kind: "companies" as const,
      scope: "memberships",
    };
    const cursor = decodeCursor(options.cursor, binding);
    const rows = await this.#repository.listCompanies(context.principalId, {
      limit: options.limit + 1,
      ...(cursor
        ? { before: { createdAt: new Date(cursor.t), id: cursor.i } }
        : {}),
    });
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > options.limit && last
          ? encodeCursor({
              c: binding.company,
              p: binding.principal,
              k: binding.kind,
              r: binding.scope,
              t: last.createdAt.toISOString(),
              i: last.id,
            })
          : null,
    };
  }

  async getCompany(
    context: HumanContext,
    companyId: string,
  ): Promise<{
    company: CompanyRecord;
    access: AccessSummary;
    responsibilityTransfer: TransferView | null;
  }> {
    const access = await this.access(context, companyId);
    requireCapability(access, "company.view");
    const company = await this.#repository.findCompany(companyId);
    if (!company) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    return {
      company,
      access: this.summarize(access),
      responsibilityTransfer: await this.transferView(access),
    };
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
