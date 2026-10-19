import { randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  maxActiveProfiles,
  OrganizationFailure,
  type Capability,
  type GrantScopeName,
  type MembershipStatus,
} from "./domain.js";
import {
  effectiveGrant,
  lockAuthority,
  violates,
  writeAudit,
  type Actor,
} from "./prisma-repository.js";

export type ProfileStatus = "ACTIVE" | "ARCHIVED";

export type ProfileRecord = Readonly<{
  id: string;
  name: string;
  capabilities: Capability[];
  status: ProfileStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  /** Memberships holding an effective grant of the profile. */
  memberCount: number;
  /** Effective grants of the profile. */
  grantCount: number;
}>;

/** One effective grant of a profile, for showing who an edit affects. */
export type ProfileHolder = Readonly<{
  grantId: string;
  membershipId: string;
  principalId: string;
  membershipStatus: MembershipStatus;
  scope: GrantScopeName;
  branches: { id: string; name: string }[];
  expiresAt: Date | null;
}>;

/** Holders listed with a profile; larger sets are reported as truncated. */
export const profileHolderLimit = 500;

type ProfileRow = {
  id: string;
  name: string;
  capabilities: Capability[];
  status: ProfileStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
  member_count: number;
  grant_count: number;
};

const profile = (row: ProfileRow): ProfileRecord => ({
  id: row.id,
  name: row.name,
  capabilities: row.capabilities,
  status: row.status,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  memberCount: row.member_count,
  grantCount: row.grant_count,
});

const effectiveProfileGrant = Prisma.sql`g.revoked_at IS NULL AND g.starts_at <= statement_timestamp()
  AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())`;

/**
 * PostgreSQL persistence of company-customized access profiles. Writers
 * take the authority locks (company, then the actor's membership) before
 * locking the profile row, and write one audit event per change.
 */
export class PrismaProfileRepository {
  readonly #db: Database;

  constructor(database: Database) {
    this.#db = database;
  }

  async list(
    companyId: string,
    options: { includeArchived: boolean; profileId?: string },
    tx: Prisma.TransactionClient | Database = this.#db,
  ): Promise<ProfileRecord[]> {
    const status = options.includeArchived
      ? Prisma.empty
      : Prisma.sql`AND p.status = 'ACTIVE'`;
    const only = options.profileId
      ? Prisma.sql`AND p.id = ${options.profileId}::uuid`
      : Prisma.empty;
    const rows = await tx.$queryRaw<ProfileRow[]>`
      SELECT p.id, p.name, p.capabilities, p.status::text AS status, p.version,
        p.created_at, p.updated_at,
        count(DISTINCT g.membership_id)::int AS member_count,
        count(g.id)::int AS grant_count
      FROM access_profiles p
      LEFT JOIN membership_grants g ON g.company_id = p.company_id AND g.profile_id = p.id
        AND ${effectiveProfileGrant}
      WHERE p.company_id = ${companyId}::uuid ${status} ${only}
      GROUP BY p.id
      ORDER BY p.status, lower(p.name), p.id`;
    return rows.map(profile);
  }

  async get(companyId: string, profileId: string): Promise<ProfileRecord> {
    const [found] = await this.list(companyId, {
      includeArchived: true,
      profileId,
    });
    if (!found) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    return found;
  }

  /** Effective grants of the profile, oldest first, up to `limit`. */
  async holders(
    companyId: string,
    profileId: string,
    limit: number,
  ): Promise<ProfileHolder[]> {
    const rows = await this.#db.$queryRaw<
      {
        grant_id: string;
        membership_id: string;
        principal_id: string;
        membership_status: MembershipStatus;
        scope: GrantScopeName;
        expires_at: Date | null;
        branches: { id: string; name: string }[];
      }[]
    >`
      SELECT g.id AS grant_id, m.id AS membership_id, m.principal_id,
        m.status::text AS membership_status, g.scope::text AS scope, g.expires_at,
        COALESCE(
          json_agg(json_build_object('id', b.id, 'name', b.name) ORDER BY lower(b.name), b.id)
            FILTER (WHERE b.id IS NOT NULL),
          '[]') AS branches
      FROM membership_grants g
      JOIN memberships m ON m.company_id = g.company_id AND m.id = g.membership_id
      LEFT JOIN membership_grant_branches gb ON gb.company_id = g.company_id AND gb.grant_id = g.id
      LEFT JOIN branches b ON b.company_id = gb.company_id AND b.id = gb.branch_id
      WHERE g.company_id = ${companyId}::uuid AND g.profile_id = ${profileId}::uuid
        AND ${effectiveProfileGrant}
      GROUP BY g.id, m.id
      ORDER BY g.created_at, g.id
      LIMIT ${limit}`;
    return rows.map((row) => ({
      grantId: row.grant_id,
      membershipId: row.membership_id,
      principalId: row.principal_id,
      membershipStatus: row.membership_status,
      scope: row.scope,
      branches: row.branches,
      expiresAt: row.expires_at,
    }));
  }

  async create(
    actor: Actor,
    companyId: string,
    input: { name: string; capabilities: Capability[] },
  ): Promise<ProfileRecord> {
    try {
      return await this.#db.$transaction(async (tx) => {
        await lockAuthority(tx, actor, companyId, []);
        const [active] = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM access_profiles
          WHERE company_id = ${companyId}::uuid AND status = 'ACTIVE'`;
        if ((active?.count ?? 0) >= maxActiveProfiles)
          throw new OrganizationFailure("PROFILE_LIMIT_REACHED");
        const id = randomUUID();
        await tx.$executeRaw`
          INSERT INTO access_profiles (id, company_id, name, capabilities)
          VALUES (${id}::uuid, ${companyId}::uuid, ${input.name}, ${input.capabilities}::text[])`;
        await writeAudit(tx, companyId, actor, {
          action: "profile.created",
          targetType: "access_profile",
          targetId: id,
          details: {
            profileName: input.name,
            capabilities: input.capabilities,
          },
        });
        const [created] = await this.list(
          companyId,
          { includeArchived: true, profileId: id },
          tx,
        );
        if (!created) throw new Error("Created profile is not readable");
        return created;
      });
    } catch (error) {
      if (violates(error, "access_profiles_company_active_name_unique"))
        throw new OrganizationFailure("PROFILE_NAME_IN_USE");
      throw error;
    }
  }

  /**
   * Renames a profile or replaces its capabilities with the observed
   * version. Every holder's access follows the new capabilities on its next
   * request; the audit event records the change and how many grants it
   * affects. An unchanged request is a no-op.
   */
  async update(
    actor: Actor,
    companyId: string,
    profileId: string,
    expectedVersion: number,
    changes: { name?: string; capabilities?: Capability[] } | { archive: true },
  ): Promise<ProfileRecord> {
    try {
      return await this.#db.$transaction(async (tx) => {
        await lockAuthority(tx, actor, companyId, []);
        const [current] = await tx.$queryRaw<
          {
            name: string;
            capabilities: Capability[];
            status: ProfileStatus;
            version: number;
          }[]
        >`
          SELECT name, capabilities, status::text AS status, version FROM access_profiles
          WHERE company_id = ${companyId}::uuid AND id = ${profileId}::uuid
          FOR UPDATE`;
        if (!current) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
        if (current.version !== expectedVersion)
          throw new OrganizationFailure("RESOURCE_VERSION_CONFLICT");
        if (current.status === "ARCHIVED")
          throw new OrganizationFailure("PROFILE_ARCHIVED");
        const [usage] = await tx.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM membership_grants
          WHERE company_id = ${companyId}::uuid AND profile_id = ${profileId}::uuid
            AND ${effectiveGrant}`;
        const affectedGrants = usage?.count ?? 0;
        if ("archive" in changes) {
          if (affectedGrants > 0)
            throw new OrganizationFailure("PROFILE_IN_USE");
          await tx.$executeRaw`
            UPDATE access_profiles SET status = 'ARCHIVED', version = version + 1,
              updated_at = GREATEST(now(), updated_at + interval '1 millisecond')
            WHERE company_id = ${companyId}::uuid AND id = ${profileId}::uuid`;
          await writeAudit(tx, companyId, actor, {
            action: "profile.archived",
            targetType: "access_profile",
            targetId: profileId,
            details: { profileName: current.name },
          });
        } else {
          const name =
            changes.name !== undefined && changes.name !== current.name
              ? changes.name
              : null;
          const added = (changes.capabilities ?? []).filter(
            (capability) => !current.capabilities.includes(capability),
          );
          const removed = changes.capabilities
            ? current.capabilities.filter(
                (capability) => !changes.capabilities!.includes(capability),
              )
            : [];
          if (name !== null || added.length > 0 || removed.length > 0) {
            await tx.$executeRaw`
              UPDATE access_profiles SET
                name = COALESCE(${name}, name),
                capabilities = COALESCE(${changes.capabilities ?? null}::text[], capabilities),
                version = version + 1,
                updated_at = GREATEST(now(), updated_at + interval '1 millisecond')
              WHERE company_id = ${companyId}::uuid AND id = ${profileId}::uuid`;
            await writeAudit(tx, companyId, actor, {
              action: "profile.updated",
              targetType: "access_profile",
              targetId: profileId,
              details: {
                profileName: name ?? current.name,
                fields: [
                  ...(name !== null ? ["name"] : []),
                  ...(added.length > 0 || removed.length > 0
                    ? ["capabilities"]
                    : []),
                ],
                addedCapabilities: added,
                removedCapabilities: removed,
                affectedGrants,
              },
            });
          }
        }
        const [updated] = await this.list(
          companyId,
          { includeArchived: true, profileId },
          tx,
        );
        if (!updated) throw new Error("Updated profile is not readable");
        return updated;
      });
    } catch (error) {
      if (violates(error, "access_profiles_company_active_name_unique"))
        throw new OrganizationFailure("PROFILE_NAME_IN_USE");
      throw error;
    }
  }
}
