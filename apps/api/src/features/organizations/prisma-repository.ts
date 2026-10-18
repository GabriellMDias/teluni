import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  OrganizationFailure,
  type AccessRole,
  type BranchStatus,
  type CompanyStatus,
  type Grant,
  type Locale,
} from "./domain.js";

export type CompanyRecord = Readonly<{
  id: string;
  displayName: string;
  status: CompanyStatus;
  defaultLocale: Locale;
  timeZone: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type BranchRecord = Readonly<{
  id: string;
  companyId: string;
  name: string;
  timeZone: string;
  status: BranchStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AuditRecord = Readonly<{
  id: string;
  occurredAt: Date;
  actorPrincipalId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
}>;

export type ResolvedMembership = Readonly<{
  companyId: string;
  companyStatus: CompanyStatus;
  membershipId: string;
  responsible: boolean;
  grants: readonly Grant[];
}>;

export type Actor = Readonly<{ principalId: string; membershipId: string }>;

type CompanyRow = {
  id: string;
  display_name: string;
  status: CompanyStatus;
  default_locale: Locale;
  time_zone: string;
  version: number;
  created_at: Date;
  updated_at: Date;
};
type BranchRow = {
  id: string;
  company_id: string;
  name: string;
  time_zone: string;
  status: BranchStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const company = (row: CompanyRow): CompanyRecord => ({
  id: row.id,
  displayName: row.display_name,
  status: row.status,
  defaultLocale: row.default_locale,
  timeZone: row.time_zone,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const branch = (row: BranchRow): BranchRecord => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  timeZone: row.time_zone,
  status: row.status,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** True when the database rejected a write through the named unique index. */
function violates(error: unknown, constraint: string): boolean {
  if (!(error instanceof Error)) return false;
  const evidence = `${error.message} ${JSON.stringify(
    (error as { meta?: unknown }).meta ?? {},
  )}`;
  return evidence.includes(constraint);
}

const companyColumns = Prisma.sql`id, display_name, status::text AS status, default_locale,
  time_zone, version, created_at, updated_at`;
const branchColumns = Prisma.sql`id, company_id, name, time_zone, status::text AS status,
  version, created_at, updated_at`;

/**
 * PostgreSQL persistence for the organizations module. Every tenant-owned
 * read and write is scoped by company ID, and audit events commit in the
 * same transaction as the change they record.
 */
export class PrismaOrganizationRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  /** The principal's active membership and effective grants, or null. */
  async resolveMembership(
    principalId: string,
    companyId: string,
  ): Promise<ResolvedMembership | null> {
    const rows = await this.#db.$queryRaw<
      {
        company_status: CompanyStatus;
        membership_id: string;
        responsible: boolean;
        grant_id: string | null;
        role: AccessRole | null;
        scope: "COMPANY" | "BRANCHES" | null;
        branch_id: string | null;
      }[]
    >`
      SELECT c.status::text AS company_status, m.id AS membership_id,
        COALESCE(r.membership_id = m.id, false) AS responsible,
        g.id AS grant_id, g.role::text AS role, g.scope::text AS scope, gb.branch_id
      FROM memberships m
      JOIN companies c ON c.id = m.company_id
      LEFT JOIN company_responsibilities r ON r.company_id = m.company_id
      LEFT JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
        AND g.revoked_at IS NULL AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
      LEFT JOIN membership_grant_branches gb ON gb.company_id = g.company_id AND gb.grant_id = g.id
      WHERE m.company_id = ${companyId}::uuid AND m.principal_id = ${principalId}::uuid
        AND m.status = 'ACTIVE'`;
    const first = rows[0];
    if (!first) return null;
    const grants = new Map<
      string,
      { role: AccessRole; scope: "COMPANY" | "BRANCHES"; branches: Set<string> }
    >();
    for (const row of rows) {
      if (!row.grant_id || !row.role || !row.scope) continue;
      const grant = grants.get(row.grant_id) ?? {
        role: row.role,
        scope: row.scope,
        branches: new Set<string>(),
      };
      if (row.branch_id) grant.branches.add(row.branch_id);
      grants.set(row.grant_id, grant);
    }
    return {
      companyId,
      companyStatus: first.company_status,
      membershipId: first.membership_id,
      responsible: first.responsible,
      grants: [...grants.values()].map((grant) =>
        grant.scope === "COMPANY"
          ? { role: grant.role, scope: "COMPANY" }
          : { role: grant.role, scope: "BRANCHES", branchIds: grant.branches },
      ),
    };
  }

  /** Companies where the principal has an active membership, with effective roles. */
  async listCompanies(
    principalId: string,
  ): Promise<(CompanyRecord & { roles: AccessRole[] })[]> {
    const rows = await this.#db.$queryRaw<
      (CompanyRow & { roles: AccessRole[] })[]
    >`
      SELECT c.id, c.display_name, c.status::text AS status, c.default_locale, c.time_zone,
        c.version, c.created_at, c.updated_at,
        COALESCE(array_agg(DISTINCT g.role::text) FILTER (WHERE g.id IS NOT NULL), '{}') AS roles
      FROM memberships m
      JOIN companies c ON c.id = m.company_id
      LEFT JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
        AND g.revoked_at IS NULL AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
      WHERE m.principal_id = ${principalId}::uuid AND m.status = 'ACTIVE'
      GROUP BY c.id
      ORDER BY lower(c.display_name), c.id
      LIMIT 200`;
    return rows.map((row) => ({
      ...company(row),
      roles: [...row.roles].sort(),
    }));
  }

  /**
   * Creates a company with its creator as active member, responsible
   * administrator and company-wide administrator, plus the audit event, in
   * one transaction. Repeating the same creator key with the same content
   * returns the existing company; different content is rejected.
   */
  async createCompany(input: {
    principalId: string;
    creationKey: string;
    displayName: string;
    defaultLocale: Locale;
    timeZone: string;
  }): Promise<{ company: CompanyRecord; replayed: boolean }> {
    // Compare retries to the original intent, even after company settings change.
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          input.displayName,
          input.defaultLocale,
          input.timeZone,
        ]),
      )
      .digest("hex");
    return this.#db.$transaction(async (tx) => {
      const id = randomUUID();
      const inserted = await tx.$queryRaw<CompanyRow[]>`
        INSERT INTO companies (id, display_name, default_locale, time_zone,
          created_by_principal_id, creation_key, creation_fingerprint)
        VALUES (${id}::uuid, ${input.displayName}, ${input.defaultLocale}, ${input.timeZone},
          ${input.principalId}::uuid, ${input.creationKey}, ${fingerprint})
        ON CONFLICT (created_by_principal_id, creation_key) DO NOTHING
        RETURNING ${companyColumns}`;
      if (!inserted[0]) {
        const [existing] = await tx.$queryRaw<
          (CompanyRow & { creation_fingerprint: string })[]
        >`
          SELECT ${companyColumns}, creation_fingerprint FROM companies
          WHERE created_by_principal_id = ${input.principalId}::uuid
            AND creation_key = ${input.creationKey}`;
        if (!existing) throw new Error("Company creation did not converge");
        if (existing.creation_fingerprint !== fingerprint)
          throw new OrganizationFailure("IDEMPOTENCY_KEY_REUSED");
        return { company: company(existing), replayed: true };
      }
      const membershipId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO memberships (id, company_id, principal_id)
        VALUES (${membershipId}::uuid, ${id}::uuid, ${input.principalId}::uuid)`;
      await tx.$executeRaw`
        INSERT INTO company_responsibilities (company_id, membership_id)
        VALUES (${id}::uuid, ${membershipId}::uuid)`;
      await tx.$executeRaw`
        INSERT INTO membership_grants (id, company_id, membership_id, role, scope)
        VALUES (${randomUUID()}::uuid, ${id}::uuid, ${membershipId}::uuid,
          'COMPANY_ADMINISTRATOR', 'COMPANY')`;
      await this.#audit(
        tx,
        id,
        { principalId: input.principalId, membershipId },
        {
          action: "company.created",
          targetType: "company",
          targetId: id,
          details: { responsibleAdministrator: true },
        },
      );
      return { company: company(inserted[0]), replayed: false };
    });
  }

  async findCompany(companyId: string): Promise<CompanyRecord | null> {
    const [row] = await this.#db.$queryRaw<CompanyRow[]>`
      SELECT ${companyColumns} FROM companies WHERE id = ${companyId}::uuid`;
    return row ? company(row) : null;
  }

  async updateCompany(
    actor: Actor,
    companyId: string,
    expectedVersion: number,
    changes: {
      displayName?: string;
      defaultLocale?: Locale;
      timeZone?: string;
    },
  ): Promise<CompanyRecord> {
    return this.#db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<CompanyRow[]>`
        UPDATE companies SET
          display_name = COALESCE(${changes.displayName ?? null}, display_name),
          default_locale = COALESCE(${changes.defaultLocale ?? null}, default_locale),
          time_zone = COALESCE(${changes.timeZone ?? null}, time_zone),
          version = version + 1,
          updated_at = GREATEST(now(), updated_at + interval '1 millisecond')
        WHERE id = ${companyId}::uuid AND version = ${expectedVersion}
        RETURNING ${companyColumns}`;
      if (!row) throw new OrganizationFailure("RESOURCE_VERSION_CONFLICT");
      await this.#audit(tx, companyId, actor, {
        action: "company.updated",
        targetType: "company",
        targetId: companyId,
        details: { fields: Object.keys(changes).sort() },
      });
      return company(row);
    });
  }

  /** Branches visible through `reach`, active first by name, keyset-paginated. */
  async listBranches(
    companyId: string,
    reach: "all" | ReadonlySet<string>,
    options: {
      limit: number;
      after?: { status: BranchStatus; name: string; id: string };
    },
  ): Promise<BranchRecord[]> {
    if (reach !== "all" && reach.size === 0) return [];
    const scope =
      reach === "all"
        ? Prisma.sql`TRUE`
        : Prisma.sql`id IN (${Prisma.join([...reach].map((id) => Prisma.sql`${id}::uuid`))})`;
    const after = options.after
      ? Prisma.sql`(status::text, lower(name), id) > (${options.after.status}, lower(${options.after.name}), ${options.after.id}::uuid)`
      : Prisma.sql`TRUE`;
    const rows = await this.#db.$queryRaw<BranchRow[]>`
      SELECT ${branchColumns} FROM branches
      WHERE company_id = ${companyId}::uuid AND ${scope} AND ${after}
      ORDER BY status::text, lower(name), id
      LIMIT ${options.limit}`;
    return rows.map(branch);
  }

  async findBranch(
    companyId: string,
    branchId: string,
  ): Promise<BranchRecord | null> {
    const [row] = await this.#db.$queryRaw<BranchRow[]>`
      SELECT ${branchColumns} FROM branches
      WHERE company_id = ${companyId}::uuid AND id = ${branchId}::uuid`;
    return row ? branch(row) : null;
  }

  async createBranch(
    actor: Actor,
    companyId: string,
    input: { name: string; timeZone: string },
  ): Promise<BranchRecord> {
    try {
      return await this.#db.$transaction(async (tx) => {
        const id = randomUUID();
        const [row] = await tx.$queryRaw<BranchRow[]>`
          INSERT INTO branches (id, company_id, name, time_zone)
          VALUES (${id}::uuid, ${companyId}::uuid, ${input.name}, ${input.timeZone})
          RETURNING ${branchColumns}`;
        await this.#audit(tx, companyId, actor, {
          action: "branch.created",
          targetType: "branch",
          targetId: id,
          details: {},
        });
        return branch(row);
      });
    } catch (error) {
      if (violates(error, "branches_company_active_name_unique"))
        throw new OrganizationFailure("BRANCH_NAME_IN_USE");
      throw error;
    }
  }

  async updateBranch(
    actor: Actor,
    companyId: string,
    branchId: string,
    expectedVersion: number,
    changes: { name?: string; timeZone?: string; archive?: true },
  ): Promise<BranchRecord> {
    try {
      return await this.#db.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<BranchRow[]>`
          UPDATE branches SET
            name = COALESCE(${changes.name ?? null}, name),
            time_zone = COALESCE(${changes.timeZone ?? null}, time_zone),
            status = CASE WHEN ${changes.archive === true} THEN 'ARCHIVED'::"BranchStatus" ELSE status END,
            version = version + 1,
            updated_at = GREATEST(now(), updated_at + interval '1 millisecond')
          WHERE company_id = ${companyId}::uuid AND id = ${branchId}::uuid
            AND version = ${expectedVersion} AND status = 'ACTIVE'
          RETURNING ${branchColumns}`;
        if (!row) {
          // Classify the failed conditional write on the transaction's own
          // connection; acquiring a second one can exhaust a busy pool.
          const [current] = await tx.$queryRaw<{ version: number }[]>`
            SELECT version FROM branches
            WHERE company_id = ${companyId}::uuid AND id = ${branchId}::uuid`;
          if (!current) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
          if (current.version !== expectedVersion)
            throw new OrganizationFailure("RESOURCE_VERSION_CONFLICT");
          throw new OrganizationFailure("BRANCH_ARCHIVED");
        }
        await this.#audit(tx, companyId, actor, {
          action: changes.archive ? "branch.archived" : "branch.updated",
          targetType: "branch",
          targetId: branchId,
          details: changes.archive
            ? {}
            : { fields: Object.keys(changes).sort() },
        });
        return branch(row);
      });
    } catch (error) {
      if (violates(error, "branches_company_active_name_unique"))
        throw new OrganizationFailure("BRANCH_NAME_IN_USE");
      throw error;
    }
  }

  async listAuditEvents(
    companyId: string,
    options: { limit: number; before?: { occurredAt: Date; id: string } },
  ): Promise<AuditRecord[]> {
    const before = options.before
      ? Prisma.sql`(occurred_at, id) < (${options.before.occurredAt}, ${options.before.id}::uuid)`
      : Prisma.sql`TRUE`;
    const rows = await this.#db.$queryRaw<
      {
        id: string;
        occurred_at: Date;
        actor_principal_id: string;
        action: string;
        target_type: string;
        target_id: string;
        details: Record<string, unknown>;
      }[]
    >`
      SELECT id, occurred_at, actor_principal_id, action, target_type, target_id, details
      FROM organization_audit_events
      WHERE company_id = ${companyId}::uuid AND ${before}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${options.limit}`;
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      actorPrincipalId: row.actor_principal_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details,
    }));
  }

  async #audit(
    tx: Prisma.TransactionClient,
    companyId: string,
    actor: Actor,
    event: {
      action: string;
      targetType: string;
      targetId: string;
      details: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO organization_audit_events (id, company_id, actor_principal_id,
        actor_membership_id, action, target_type, target_id, details)
      VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${actor.principalId}::uuid,
        ${actor.membershipId}::uuid, ${event.action}, ${event.targetType},
        ${event.targetId}::uuid, ${JSON.stringify(event.details)}::jsonb)`;
  }
}
