import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  delegableCapabilities,
  OrganizationFailure,
  responsibilityTransferDays,
  type AccessRole,
  type Capability,
  type GrantAuthority,
  type AuditVisibility,
  type GrantScopeName,
  type BranchStatus,
  type CompanyStatus,
  type Grant,
  type Locale,
  type MembershipStatus,
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

/** A grant that has not been revoked and has not expired. */
export type GrantRecord = Readonly<{
  id: string;
  /** The standard role, or null when the grant carries an access profile. */
  role: AccessRole | null;
  profile: { id: string; name: string } | null;
  scope: GrantScopeName;
  branches: { id: string; name: string }[];
  startsAt: Date;
  expiresAt: Date | null;
}>;

export type MemberRecord = Readonly<{
  id: string;
  principalId: string;
  status: MembershipStatus;
  version: number;
  responsible: boolean;
  roles: AccessRole[];
  grants: GrantRecord[];
}>;

export type TransferRecord = Readonly<{
  id: string;
  fromMembershipId: string;
  toMembershipId: string;
  fromPrincipalId: string;
  toPrincipalId: string;
  createdAt: Date;
  expiresAt: Date;
}>;

export type LockedMember = {
  id: string;
  principal_id: string;
  status: MembershipStatus;
  version: number;
};

export const effectiveGrant = Prisma.sql`revoked_at IS NULL AND starts_at <= statement_timestamp()
  AND (expires_at IS NULL OR expires_at > statement_timestamp())`;

/** A grant row joined with its branch scope and active profile, for access decisions. */
export type GrantAccessRow = {
  grant_id: string | null;
  role: AccessRole | null;
  profile_id: string | null;
  profile_capabilities: string[] | null;
  profile_name: string | null;
  scope: GrantScopeName | null;
  branch_id: string | null;
};

/**
 * Columns and joins that read effective grants as GrantAccessRow; the query
 * aliases memberships as `m` and joins membership_grants as `g`. A profile
 * grant counts only while its profile is active.
 */
export const grantAccessColumns = Prisma.sql`g.id AS grant_id, g.role::text AS role,
  p.id AS profile_id, p.name AS profile_name, p.capabilities AS profile_capabilities, g.scope::text AS scope, gb.branch_id`;
export const grantAccessJoins = Prisma.sql`
  LEFT JOIN access_profiles p ON p.company_id = g.company_id AND p.id = g.profile_id
    AND p.status = 'ACTIVE'
  LEFT JOIN membership_grant_branches gb ON gb.company_id = g.company_id AND gb.grant_id = g.id`;

/** Folds GrantAccessRow rows into the grants a CompanyAccess carries. */
export function grantsFromRows(rows: readonly GrantAccessRow[]): Grant[] {
  const grants = new Map<
    string,
    {
      authority: GrantAuthority;
      scope: GrantScopeName;
      branches: Set<string>;
    }
  >();
  for (const row of rows) {
    if (!row.grant_id || !row.scope) continue;
    let grant = grants.get(row.grant_id);
    if (!grant) {
      const authority: GrantAuthority | null = row.role
        ? { role: row.role }
        : row.profile_id && row.profile_capabilities
          ? {
              profileId: row.profile_id,
              profileName: row.profile_name ?? "",
              capabilities: new Set(
                row.profile_capabilities.filter((capability) =>
                  (delegableCapabilities as readonly string[]).includes(
                    capability,
                  ),
                ) as Capability[],
              ),
            }
          : null;
      if (!authority) continue;
      grant = { authority, scope: row.scope, branches: new Set<string>() };
      grants.set(row.grant_id, grant);
    }
    if (row.branch_id) grant.branches.add(row.branch_id);
  }
  return [...grants.values()].map(({ authority, scope, branches }): Grant =>
    scope === "COMPANY"
      ? { ...authority, scope: "COMPANY" }
      : { ...authority, scope: "BRANCHES", branchIds: branches },
  );
}

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
export function violates(error: unknown, constraint: string): boolean {
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
 * Takes the authority locks every authority-changing writer uses: the
 * company row first, then the involved memberships in ID order. It then
 * rechecks that the actor is still an active company administrator.
 */
export async function lockAuthority(
  tx: Prisma.TransactionClient,
  actor: Actor,
  companyId: string,
  otherMembershipIds: readonly string[],
): Promise<{
  members: Map<string, LockedMember>;
  administrators: Set<string>;
  responsibleMembershipId: string | null;
}> {
  const [company] = await tx.$queryRaw<{ status: CompanyStatus }[]>`
    SELECT status::text AS status FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
  const ids = [...new Set([actor.membershipId, ...otherMembershipIds])];
  const locked = await tx.$queryRaw<LockedMember[]>`
    SELECT id, principal_id, status::text AS status, version FROM memberships
    WHERE company_id = ${companyId}::uuid
      AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id FOR UPDATE`;
  const members = new Map(locked.map((member) => [member.id, member]));
  const current = members.get(actor.membershipId);
  if (
    !company ||
    !current ||
    current.principal_id !== actor.principalId ||
    current.status !== "ACTIVE"
  )
    throw new OrganizationFailure("RESOURCE_NOT_FOUND");
  if (company.status !== "ACTIVE")
    throw new OrganizationFailure("COMPANY_SUSPENDED");
  const adminGrants = await tx.$queryRaw<{ membership_id: string }[]>`
    SELECT membership_id FROM membership_grants WHERE company_id = ${companyId}::uuid
      AND role = 'COMPANY_ADMINISTRATOR' AND scope = 'COMPANY' AND ${effectiveGrant}`;
  const administrators = new Set(
    adminGrants.map((grant) => grant.membership_id),
  );
  if (!administrators.has(actor.membershipId))
    throw new OrganizationFailure("PERMISSION_DENIED");
  const [responsibility] = await tx.$queryRaw<{ membership_id: string }[]>`
    SELECT membership_id FROM company_responsibilities WHERE company_id = ${companyId}::uuid`;
  return {
    members,
    administrators,
    responsibleMembershipId: responsibility?.membership_id ?? null,
  };
}

export async function requireRecent(
  tx: Prisma.TransactionClient,
  strongAuthenticatedAt: Date | null,
): Promise<void> {
  const [assurance] = await tx.$queryRaw<{ recent: boolean }[]>`
    SELECT (${strongAuthenticatedAt}::timestamptz IS NOT NULL AND
      ${strongAuthenticatedAt}::timestamptz >= statement_timestamp() - interval '5 minutes') AS recent`;
  if (!assurance?.recent)
    throw new OrganizationFailure("RECENT_AUTHENTICATION_REQUIRED");
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  companyId: string,
  actor: Actor,
  event: {
    action: string;
    targetType: string;
    targetId: string;
    details: Record<string, unknown>;
    /** Branches the event concerns; none makes it a company-level event. */
    branchIds?: readonly string[];
  },
): Promise<void> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO organization_audit_events (id, company_id, actor_principal_id,
      actor_membership_id, action, target_type, target_id, details)
    VALUES (${id}::uuid, ${companyId}::uuid, ${actor.principalId}::uuid,
      ${actor.membershipId}::uuid, ${event.action}, ${event.targetType},
      ${event.targetId}::uuid, ${JSON.stringify(event.details)}::jsonb)`;
  for (const branchId of new Set(event.branchIds ?? []))
    await tx.$executeRaw`
      INSERT INTO organization_audit_event_branches (company_id, event_id, branch_id)
      VALUES (${companyId}::uuid, ${id}::uuid, ${branchId}::uuid)`;
}

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

  async listMembers(
    companyId: string,
    options: { limit: number; after?: string },
  ): Promise<MemberRecord[]> {
    const after = options.after
      ? Prisma.sql`AND m.id > ${options.after}::uuid`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<
      {
        id: string;
        principal_id: string;
        status: MembershipStatus;
        version: number;
        responsible: boolean;
        roles: AccessRole[];
      }[]
    >`
      SELECT m.id, m.principal_id, m.status::text AS status, m.version,
        COALESCE(r.membership_id = m.id, false) AS responsible,
        COALESCE(array_agg(DISTINCT g.role::text) FILTER (WHERE g.role IS NOT NULL), '{}') AS roles
      FROM memberships m
      LEFT JOIN company_responsibilities r ON r.company_id = m.company_id
      LEFT JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
        AND g.revoked_at IS NULL AND g.starts_at <= statement_timestamp()
        AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())
      WHERE m.company_id = ${companyId}::uuid ${after}
      GROUP BY m.id, r.membership_id ORDER BY m.id LIMIT ${options.limit}`;
    const grants = await this.#grantsOf(
      companyId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      id: row.id,
      principalId: row.principal_id,
      status: row.status,
      version: row.version,
      responsible: row.responsible,
      roles: [...row.roles].sort(),
      grants: grants.get(row.id) ?? [],
    }));
  }

  /** Unrevoked, unexpired grants of the given memberships, with branch names. */
  async #grantsOf(
    companyId: string,
    membershipIds: readonly string[],
    tx: Prisma.TransactionClient | Database = this.#db,
  ): Promise<Map<string, GrantRecord[]>> {
    const result = new Map<string, GrantRecord[]>();
    if (membershipIds.length === 0) return result;
    const rows = await tx.$queryRaw<
      {
        id: string;
        membership_id: string;
        role: AccessRole | null;
        profile_id: string | null;
        profile_name: string | null;
        scope: GrantScopeName;
        starts_at: Date;
        expires_at: Date | null;
        branch_id: string | null;
        branch_name: string | null;
      }[]
    >`
      SELECT g.id, g.membership_id, g.role::text AS role, p.id AS profile_id,
        p.name AS profile_name, g.scope::text AS scope,
        g.starts_at, g.expires_at, b.id AS branch_id, b.name AS branch_name
      FROM membership_grants g
      LEFT JOIN access_profiles p ON p.company_id = g.company_id AND p.id = g.profile_id
      LEFT JOIN membership_grant_branches gb ON gb.company_id = g.company_id AND gb.grant_id = g.id
      LEFT JOIN branches b ON b.company_id = gb.company_id AND b.id = gb.branch_id
      WHERE g.company_id = ${companyId}::uuid
        AND g.membership_id IN (${Prisma.join(membershipIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())
      ORDER BY g.created_at, g.id, lower(b.name), b.id`;
    const byId = new Map<
      string,
      GrantRecord & { membershipId: string; branches: GrantRecord["branches"] }
    >();
    for (const row of rows) {
      let grant = byId.get(row.id);
      if (!grant) {
        grant = {
          id: row.id,
          membershipId: row.membership_id,
          role: row.role,
          profile:
            row.profile_id && row.profile_name
              ? { id: row.profile_id, name: row.profile_name }
              : null,
          scope: row.scope,
          branches: [],
          startsAt: row.starts_at,
          expiresAt: row.expires_at,
        };
        byId.set(row.id, grant);
      }
      if (row.branch_id && row.branch_name)
        grant.branches.push({ id: row.branch_id, name: row.branch_name });
    }
    for (const { membershipId, ...grant } of byId.values())
      result.set(membershipId, [...(result.get(membershipId) ?? []), grant]);
    return result;
  }

  /** Active memberships other than `excluded` that keep an effective administrator grant. */
  async #otherActiveAdministrators(
    tx: Prisma.TransactionClient,
    companyId: string,
    excluded: string,
  ): Promise<number> {
    const [remaining] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(DISTINCT m.id)::int AS count FROM memberships m
      JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
      WHERE m.company_id = ${companyId}::uuid AND m.status = 'ACTIVE' AND m.id <> ${excluded}::uuid
        AND g.role = 'COMPANY_ADMINISTRATOR' AND g.scope = 'COMPANY'
        AND g.revoked_at IS NULL AND g.starts_at <= statement_timestamp()
        AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())`;
    return remaining?.count ?? 0;
  }

  /**
   * Adds a standard-role grant to a membership. Only the responsible
   * administrator, recently strongly authenticated, may grant company
   * administration (P10/P14). An identical effective grant is returned
   * instead of duplicated.
   */
  async addGrant(
    actor: Actor,
    companyId: string,
    memberId: string,
    input: {
      /** Exactly one of role and profileId is set. */
      role: AccessRole | null;
      profileId: string | null;
      scope: GrantScopeName;
      branchIds: string[];
      expiresAt: Date | null;
    },
    strongAuthenticatedAt: Date | null,
  ): Promise<{ grant: GrantRecord; created: boolean }> {
    return this.#db.$transaction(async (tx) => {
      const authority = await lockAuthority(tx, actor, companyId, [memberId]);
      const target = authority.members.get(memberId);
      if (!target) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      if (target.status === "REMOVED")
        throw new OrganizationFailure("MEMBERSHIP_REMOVED");
      if (input.role === "COMPANY_ADMINISTRATOR") {
        if (authority.responsibleMembershipId !== actor.membershipId)
          throw new OrganizationFailure("RESPONSIBLE_APPROVAL_REQUIRED");
        await requireRecent(tx, strongAuthenticatedAt);
      }
      if (input.expiresAt) {
        const [future] = await tx.$queryRaw<{ valid: boolean }[]>`
          SELECT ${input.expiresAt}::timestamptz > statement_timestamp() + interval '1 minute' AS valid`;
        if (!future?.valid) throw new OrganizationFailure("VALIDATION_FAILED");
      }
      if (input.scope === "BRANCHES") {
        // Unknown, archived and other companies' branches are rejected alike.
        const branches = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM branches WHERE company_id = ${companyId}::uuid AND status = 'ACTIVE'
            AND id IN (${Prisma.join(input.branchIds.map((id) => Prisma.sql`${id}::uuid`))})
          FOR SHARE`;
        if (branches.length !== input.branchIds.length)
          throw new OrganizationFailure("VALIDATION_FAILED");
      }
      let profileName: string | null = null;
      if (input.profileId) {
        // Unknown, archived and other companies' profiles are rejected alike;
        // the share lock keeps the profile active until this grant commits.
        const [profile] = await tx.$queryRaw<{ name: string }[]>`
          SELECT name FROM access_profiles WHERE company_id = ${companyId}::uuid
            AND id = ${input.profileId}::uuid AND status = 'ACTIVE'
          FOR SHARE`;
        if (!profile) throw new OrganizationFailure("VALIDATION_FAILED");
        profileName = profile.name;
      }
      const existing = (await this.#grantsOf(companyId, [memberId], tx))
        .get(memberId)
        ?.find(
          (grant) =>
            grant.role === input.role &&
            (grant.profile?.id ?? null) === input.profileId &&
            grant.scope === input.scope &&
            (grant.expiresAt?.getTime() ?? null) ===
              (input.expiresAt?.getTime() ?? null) &&
            grant.branches
              .map((branch) => branch.id)
              .sort()
              .join(",") === input.branchIds.join(","),
        );
      if (existing) return { grant: existing, created: false };
      const grantId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO membership_grants (id, company_id, membership_id, role, profile_id,
          scope, expires_at, granted_by_membership_id)
        VALUES (${grantId}::uuid, ${companyId}::uuid, ${memberId}::uuid,
          ${input.role}::"AccessRole", ${input.profileId}::uuid, ${input.scope}::"GrantScope",
          ${input.expiresAt}::timestamptz, ${actor.membershipId}::uuid)`;
      for (const branchId of input.branchIds)
        await tx.$executeRaw`
          INSERT INTO membership_grant_branches (company_id, grant_id, branch_id)
          VALUES (${companyId}::uuid, ${grantId}::uuid, ${branchId}::uuid)`;
      await writeAudit(tx, companyId, actor, {
        action: "grant.created",
        targetType: "membership",
        targetId: memberId,
        details: {
          grantId,
          ...(input.role
            ? { role: input.role }
            : { profileId: input.profileId, profileName }),
          scope: input.scope,
          branchCount: input.branchIds.length,
          expiresAt: input.expiresAt?.toISOString() ?? null,
        },
        branchIds: input.branchIds,
      });
      const created = (await this.#grantsOf(companyId, [memberId], tx))
        .get(memberId)
        ?.find((grant) => grant.id === grantId);
      if (!created) throw new Error("Created grant is not readable");
      return { grant: created, created: true };
    });
  }

  /**
   * Revokes a grant. The responsible administrator and the last active
   * administrator keep company administration; an already revoked or
   * expired grant is a no-op.
   */
  async revokeGrant(
    actor: Actor,
    companyId: string,
    memberId: string,
    grantId: string,
  ): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      const authority = await lockAuthority(tx, actor, companyId, [memberId]);
      const target = authority.members.get(memberId);
      if (!target) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      const [grant] = await tx.$queryRaw<
        {
          role: AccessRole | null;
          profile_id: string | null;
          profile_name: string | null;
          scope: GrantScopeName;
          effective: boolean;
        }[]
      >`
        SELECT role::text AS role, profile_id, scope::text AS scope,
          (SELECT p.name FROM access_profiles p
            WHERE p.company_id = membership_grants.company_id
              AND p.id = membership_grants.profile_id) AS profile_name,
          (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > statement_timestamp())) AS effective
        FROM membership_grants
        WHERE company_id = ${companyId}::uuid AND id = ${grantId}::uuid
          AND membership_id = ${memberId}::uuid
        FOR UPDATE`;
      if (!grant) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      if (!grant.effective) return;
      if (grant.role === "COMPANY_ADMINISTRATOR") {
        const [other] = await tx.$queryRaw<{ present: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM membership_grants
            WHERE company_id = ${companyId}::uuid AND membership_id = ${memberId}::uuid
              AND id <> ${grantId}::uuid AND role = 'COMPANY_ADMINISTRATOR'
              AND scope = 'COMPANY' AND ${effectiveGrant}) AS present`;
        if (!other?.present) {
          if (authority.responsibleMembershipId === memberId)
            throw new OrganizationFailure(
              "RESPONSIBLE_ADMINISTRATOR_PROTECTED",
            );
          if (
            target.status === "ACTIVE" &&
            (await this.#otherActiveAdministrators(tx, companyId, memberId)) ===
              0
          )
            throw new OrganizationFailure("LAST_ADMINISTRATOR_REQUIRED");
        }
      }
      await tx.$executeRaw`
        UPDATE membership_grants SET revoked_at = statement_timestamp()
        WHERE company_id = ${companyId}::uuid AND id = ${grantId}::uuid AND revoked_at IS NULL`;
      const branches = await tx.$queryRaw<{ branch_id: string }[]>`
        SELECT branch_id FROM membership_grant_branches
        WHERE company_id = ${companyId}::uuid AND grant_id = ${grantId}::uuid`;
      await writeAudit(tx, companyId, actor, {
        action: "grant.revoked",
        targetType: "membership",
        targetId: memberId,
        details: {
          grantId,
          ...(grant.role
            ? { role: grant.role }
            : { profileId: grant.profile_id, profileName: grant.profile_name }),
          scope: grant.scope,
        },
        branchIds: branches.map((row) => row.branch_id),
      });
    });
  }

  /** The pending, unexpired transfer in which the membership takes part, if any. */
  async currentTransfer(
    companyId: string,
    membershipId: string,
  ): Promise<TransferRecord | null> {
    const [row] = await this.#db.$queryRaw<
      {
        id: string;
        from_membership_id: string;
        to_membership_id: string;
        from_principal_id: string;
        to_principal_id: string;
        created_at: Date;
        expires_at: Date;
      }[]
    >`
      SELECT t.id, t.from_membership_id, t.to_membership_id,
        f.principal_id AS from_principal_id, s.principal_id AS to_principal_id,
        t.created_at, t.expires_at
      FROM responsibility_transfers t
      JOIN memberships f ON f.company_id = t.company_id AND f.id = t.from_membership_id
      JOIN memberships s ON s.company_id = t.company_id AND s.id = t.to_membership_id
      WHERE t.company_id = ${companyId}::uuid AND t.status = 'PENDING'
        AND t.expires_at > statement_timestamp()
        AND ${membershipId}::uuid IN (t.from_membership_id, t.to_membership_id)`;
    return row
      ? {
          id: row.id,
          fromMembershipId: row.from_membership_id,
          toMembershipId: row.to_membership_id,
          fromPrincipalId: row.from_principal_id,
          toPrincipalId: row.to_principal_id,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  /**
   * Proposes handing responsibility to another active administrator. Only
   * the responsible administrator, recently strongly authenticated, may
   * propose, and only one proposal per company can be pending.
   */
  async requestTransfer(
    actor: Actor,
    companyId: string,
    successorId: string,
    strongAuthenticatedAt: Date | null,
  ): Promise<string> {
    return this.#db.$transaction(async (tx) => {
      const authority = await lockAuthority(tx, actor, companyId, [
        successorId,
      ]);
      if (authority.responsibleMembershipId !== actor.membershipId)
        throw new OrganizationFailure("RESPONSIBLE_APPROVAL_REQUIRED");
      await requireRecent(tx, strongAuthenticatedAt);
      const successor = authority.members.get(successorId);
      if (!successor) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      if (successorId === actor.membershipId)
        throw new OrganizationFailure("VALIDATION_FAILED");
      if (
        successor.status !== "ACTIVE" ||
        !authority.administrators.has(successorId)
      )
        throw new OrganizationFailure("SUCCESSOR_NOT_ELIGIBLE");
      await tx.$executeRaw`
        UPDATE responsibility_transfers SET status = 'EXPIRED', decided_at = statement_timestamp()
        WHERE company_id = ${companyId}::uuid AND status = 'PENDING'
          AND expires_at <= statement_timestamp()`;
      const [pending] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM responsibility_transfers
        WHERE company_id = ${companyId}::uuid AND status = 'PENDING'`;
      if (pending)
        throw new OrganizationFailure("RESPONSIBILITY_TRANSFER_PENDING");
      const transferId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO responsibility_transfers (id, company_id, from_membership_id,
          to_membership_id, created_at, expires_at)
        VALUES (${transferId}::uuid, ${companyId}::uuid, ${actor.membershipId}::uuid,
          ${successorId}::uuid, statement_timestamp(),
          statement_timestamp() + make_interval(days => ${responsibilityTransferDays}))`;
      await writeAudit(tx, companyId, actor, {
        action: "responsibility.transfer_requested",
        targetType: "membership",
        targetId: successorId,
        details: { transferId },
      });
      return transferId;
    });
  }

  /** Locks a transfer under the company lock and classifies a stale one. */
  async #lockPendingTransfer(
    tx: Prisma.TransactionClient,
    companyId: string,
    transferId: string,
    actorMembershipId: string,
  ): Promise<{ from: string; to: string }> {
    await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
    const [transfer] = await tx.$queryRaw<
      {
        from_membership_id: string;
        to_membership_id: string;
        status: string;
        expired: boolean;
      }[]
    >`
      SELECT from_membership_id, to_membership_id, status::text AS status,
        expires_at <= statement_timestamp() AS expired
      FROM responsibility_transfers
      WHERE company_id = ${companyId}::uuid AND id = ${transferId}::uuid FOR UPDATE`;
    // Only the two parties learn that a transfer exists.
    if (
      !transfer ||
      ![transfer.from_membership_id, transfer.to_membership_id].includes(
        actorMembershipId,
      )
    )
      throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    // An expired proposal is treated as closed; a new proposal marks it EXPIRED.
    if (transfer.status !== "PENDING" || transfer.expired)
      throw new OrganizationFailure("RESPONSIBILITY_TRANSFER_NOT_PENDING");
    return {
      from: transfer.from_membership_id,
      to: transfer.to_membership_id,
    };
  }

  /**
   * The successor accepts responsibility: they must still be an active
   * administrator, recently strongly authenticated, and the proposer must
   * still be responsible.
   */
  async acceptTransfer(
    actor: Actor,
    companyId: string,
    transferId: string,
    strongAuthenticatedAt: Date | null,
  ): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      const transfer = await this.#lockPendingTransfer(
        tx,
        companyId,
        transferId,
        actor.membershipId,
      );
      if (transfer.to !== actor.membershipId)
        throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      const authority = await lockAuthority(tx, actor, companyId, [
        transfer.from,
      ]);
      await requireRecent(tx, strongAuthenticatedAt);
      if (authority.responsibleMembershipId !== transfer.from)
        throw new OrganizationFailure("RESPONSIBILITY_TRANSFER_NOT_PENDING");
      await tx.$executeRaw`
        UPDATE company_responsibilities
        SET membership_id = ${actor.membershipId}::uuid, assigned_at = statement_timestamp()
        WHERE company_id = ${companyId}::uuid AND membership_id = ${transfer.from}::uuid`;
      await tx.$executeRaw`
        UPDATE responsibility_transfers SET status = 'ACCEPTED', decided_at = statement_timestamp()
        WHERE company_id = ${companyId}::uuid AND id = ${transferId}::uuid`;
      await writeAudit(tx, companyId, actor, {
        action: "responsibility.transferred",
        targetType: "membership",
        targetId: actor.membershipId,
        details: { transferId, previousMembershipId: transfer.from },
      });
    });
  }

  /** The proposer cancels, or the successor declines, a pending transfer. */
  async closeTransfer(
    actor: Actor,
    companyId: string,
    transferId: string,
  ): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      const transfer = await this.#lockPendingTransfer(
        tx,
        companyId,
        transferId,
        actor.membershipId,
      );
      const [member] = await tx.$queryRaw<LockedMember[]>`
        SELECT id, principal_id, status::text AS status, version FROM memberships
        WHERE company_id = ${companyId}::uuid AND id = ${actor.membershipId}::uuid FOR UPDATE`;
      if (
        !member ||
        member.principal_id !== actor.principalId ||
        member.status !== "ACTIVE"
      )
        throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      const declined = transfer.to === actor.membershipId;
      await tx.$executeRaw`
        UPDATE responsibility_transfers
        SET status = ${declined ? "DECLINED" : "CANCELLED"}::"ResponsibilityTransferStatus",
          decided_at = statement_timestamp()
        WHERE company_id = ${companyId}::uuid AND id = ${transferId}::uuid`;
      await writeAudit(tx, companyId, actor, {
        action: declined
          ? "responsibility.transfer_declined"
          : "responsibility.transfer_cancelled",
        targetType: "membership",
        targetId: transfer.to,
        details: { transferId },
      });
    });
  }

  /** Company-first locking is mandatory for every authority-changing writer. */
  async updateMemberStatus(
    actor: Actor,
    companyId: string,
    memberId: string,
    expectedVersion: number,
    status: MembershipStatus,
    strongAuthenticatedAt: Date | null,
  ): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      const [company] = await tx.$queryRaw<{ status: CompanyStatus }[]>`
        SELECT status::text AS status FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
      // Lock both memberships in a deterministic order. Recheck after waiting,
      // rather than trusting the service's earlier access snapshot.
      const members = await tx.$queryRaw<
        {
          id: string;
          principal_id: string;
          status: MembershipStatus;
          version: number;
        }[]
      >`
        SELECT id, principal_id, status::text AS status, version FROM memberships
        WHERE company_id = ${companyId}::uuid AND id IN (${actor.membershipId}::uuid, ${memberId}::uuid)
        ORDER BY id FOR UPDATE`;
      const currentActor = members.find(
        (member) => member.id === actor.membershipId,
      );
      if (
        !company ||
        !currentActor ||
        currentActor.principal_id !== actor.principalId ||
        currentActor.status !== "ACTIVE"
      )
        throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      if (company.status !== "ACTIVE")
        throw new OrganizationFailure("COMPANY_SUSPENDED");
      const adminGrants = await tx.$queryRaw<{ membership_id: string }[]>`
        SELECT membership_id FROM membership_grants WHERE company_id = ${companyId}::uuid
          AND role = 'COMPANY_ADMINISTRATOR' AND scope = 'COMPANY'
          AND revoked_at IS NULL AND starts_at <= statement_timestamp()
          AND (expires_at IS NULL OR expires_at > statement_timestamp())`;
      const administrators = new Set(
        adminGrants.map((grant) => grant.membership_id),
      );
      if (!administrators.has(actor.membershipId))
        throw new OrganizationFailure("PERMISSION_DENIED");
      const target = members.find((member) => member.id === memberId);
      if (!target) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      if (target.version !== expectedVersion)
        throw new OrganizationFailure("RESOURCE_VERSION_CONFLICT");
      if (target.status === "REMOVED")
        throw new OrganizationFailure("MEMBERSHIP_REMOVED");
      if (target.status === status) return;
      const [responsibility] = await tx.$queryRaw<{ membership_id: string }[]>`
        SELECT membership_id FROM company_responsibilities WHERE company_id = ${companyId}::uuid`;
      if (status !== "ACTIVE" && responsibility?.membership_id === memberId)
        throw new OrganizationFailure("RESPONSIBLE_ADMINISTRATOR_PROTECTED");
      const [restoringAdministrator] = await tx.$queryRaw<
        { present: boolean }[]
      >`
        SELECT EXISTS (SELECT 1 FROM membership_grants
          WHERE company_id = ${companyId}::uuid AND membership_id = ${memberId}::uuid
            AND role = 'COMPANY_ADMINISTRATOR' AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > statement_timestamp())) AS present`;
      if (status === "ACTIVE" && restoringAdministrator?.present) {
        if (responsibility?.membership_id !== actor.membershipId)
          throw new OrganizationFailure("RESPONSIBLE_APPROVAL_REQUIRED");
        const [assurance] = await tx.$queryRaw<{ recent: boolean }[]>`
          SELECT (${strongAuthenticatedAt}::timestamptz IS NOT NULL AND
            ${strongAuthenticatedAt}::timestamptz >= statement_timestamp() - interval '5 minutes') AS recent`;
        if (!assurance?.recent)
          throw new OrganizationFailure("RECENT_AUTHENTICATION_REQUIRED");
      }
      if (status !== "ACTIVE" && administrators.has(memberId)) {
        const [remaining] = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(DISTINCT m.id)::int AS count FROM memberships m
          JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
          WHERE m.company_id = ${companyId}::uuid AND m.status = 'ACTIVE' AND m.id <> ${memberId}::uuid
            AND g.role = 'COMPANY_ADMINISTRATOR' AND g.scope = 'COMPANY'
            AND g.revoked_at IS NULL AND g.starts_at <= statement_timestamp()
            AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())`;
        if (!remaining || remaining.count === 0)
          throw new OrganizationFailure("LAST_ADMINISTRATOR_REQUIRED");
      }
      await tx.$executeRaw`UPDATE memberships SET status = ${status}::"MembershipStatus", version = version + 1,
        updated_at = GREATEST(statement_timestamp(), updated_at + interval '1 millisecond')
        WHERE company_id = ${companyId}::uuid AND id = ${memberId}::uuid AND version = ${expectedVersion}`;
      await writeAudit(tx, companyId, actor, {
        action: "membership.status_changed",
        targetType: "membership",
        targetId: memberId,
        details: { previousStatus: target.status, status },
      });
    });
  }

  /** The principal's active membership and effective grants, or null. */
  async resolveMembership(
    principalId: string,
    companyId: string,
  ): Promise<ResolvedMembership | null> {
    const rows = await this.#db.$queryRaw<
      ({
        company_status: CompanyStatus;
        membership_id: string;
        responsible: boolean;
      } & GrantAccessRow)[]
    >`
      SELECT c.status::text AS company_status, m.id AS membership_id,
        COALESCE(r.membership_id = m.id, false) AS responsible, ${grantAccessColumns}
      FROM memberships m
      JOIN companies c ON c.id = m.company_id
      LEFT JOIN company_responsibilities r ON r.company_id = m.company_id
      LEFT JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
        AND g.revoked_at IS NULL AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
      ${grantAccessJoins}
      WHERE m.company_id = ${companyId}::uuid AND m.principal_id = ${principalId}::uuid
        AND m.status = 'ACTIVE'`;
    const first = rows[0];
    if (!first) return null;
    return {
      companyId,
      companyStatus: first.company_status,
      membershipId: first.membership_id,
      responsible: first.responsible,
      grants: grantsFromRows(rows),
    };
  }

  /** Companies where the principal has an active membership, with effective roles. */
  async listCompanies(
    principalId: string,
    options: { limit: number; before?: { createdAt: Date; id: string } },
  ): Promise<(CompanyRecord & { roles: AccessRole[] })[]> {
    const before = options.before
      ? Prisma.sql`AND (c.created_at, c.id) < (${options.before.createdAt}, ${options.before.id}::uuid)`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<
      (CompanyRow & { roles: AccessRole[] })[]
    >`
      SELECT c.id, c.display_name, c.status::text AS status, c.default_locale, c.time_zone,
        c.version, c.created_at, c.updated_at,
        COALESCE(array_agg(DISTINCT g.role::text) FILTER (WHERE g.role IS NOT NULL), '{}') AS roles
      FROM memberships m
      JOIN companies c ON c.id = m.company_id
      LEFT JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
        AND g.revoked_at IS NULL AND g.starts_at <= now()
        AND (g.expires_at IS NULL OR g.expires_at > now())
      WHERE m.principal_id = ${principalId}::uuid AND m.status = 'ACTIVE'
        ${before}
      GROUP BY c.id
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${options.limit}`;
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
      await writeAudit(
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
      await writeAudit(tx, companyId, actor, {
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
        await writeAudit(tx, companyId, actor, {
          action: "branch.created",
          targetType: "branch",
          targetId: id,
          details: { branchName: row.name },
          branchIds: [id],
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
        await writeAudit(tx, companyId, actor, {
          action: changes.archive ? "branch.archived" : "branch.updated",
          targetType: "branch",
          targetId: branchId,
          details: changes.archive
            ? { branchName: row.name }
            : { branchName: row.name, fields: Object.keys(changes).sort() },
          branchIds: [branchId],
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
    visibility: AuditVisibility,
    options: { limit: number; before?: { occurredAt: Date; id: string } },
  ): Promise<AuditRecord[]> {
    const before = options.before
      ? Prisma.sql`(occurred_at, id) < (${options.before.occurredAt}, ${options.before.id}::uuid)`
      : Prisma.sql`TRUE`;
    // Branch visibility is part of the query, before ordering and the limit.
    const visible =
      visibility.kind === "all"
        ? Prisma.sql`TRUE`
        : Prisma.sql`EXISTS (SELECT 1 FROM organization_audit_event_branches eb
              WHERE eb.company_id = e.company_id AND eb.event_id = e.id)
            AND ${
              visibility.branches === "all"
                ? Prisma.sql`TRUE`
                : Prisma.sql`NOT EXISTS (SELECT 1 FROM organization_audit_event_branches eb
                    WHERE eb.company_id = e.company_id AND eb.event_id = e.id
                      AND eb.branch_id NOT IN (${Prisma.join(
                        visibility.branches.map(
                          (id) => Prisma.sql`${id}::uuid`,
                        ),
                      )}))`
            }`;
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
      FROM organization_audit_events e
      WHERE company_id = ${companyId}::uuid AND ${before} AND ${visible}
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
}
