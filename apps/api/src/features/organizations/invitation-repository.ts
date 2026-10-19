import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "../../database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { MailOutboxPort } from "../mail/public.js";
import {
  companyAccess,
  invitationAddressRetentionDays,
  invitationDays,
  invitationDecision,
  invitationLimits,
  invitationVisibility,
  reachableWithStrongAuthentication,
  type InvitationVisibility,
  OrganizationFailure,
  type AccessRole,
  type CompanyAccess,
  type CompanyStatus,
  type GrantScopeName,
  type Locale,
  type MembershipStatus,
} from "./domain.js";
import {
  grantAccessColumns,
  grantAccessJoins,
  grantsFromRows,
  requireRecent,
  writeAudit,
  type Actor,
  type GrantAccessRow,
} from "./prisma-repository.js";

export type InvitationStatus =
  "PENDING" | "ACCEPTED" | "REVOKED" | "REPLACED" | "EXPIRED";

export type InvitationRecord = Readonly<{
  id: string;
  recipientEmail: string | null;
  role: AccessRole;
  scope: GrantScopeName;
  branches: { id: string; name: string }[];
  grantExpiresAt: Date | null;
  /** PENDING past its expiry reads as EXPIRED. */
  status: InvitationStatus;
  invitedByPrincipalId: string;
  messageId: string | null;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
}>;

export type InvitationPreview = Readonly<{
  companyId: string;
  companyName: string;
  role: AccessRole;
  scope: GrantScopeName;
  branches: { id: string; name: string }[];
  grantExpiresAt: Date | null;
  expiresAt: Date;
  invitedByPrincipalId: string;
  /** ACCEPTED only when the caller accepted it. */
  status: "PENDING" | "ACCEPTED";
}>;

export type GrantRequest = Readonly<{
  role: AccessRole;
  scope: GrantScopeName;
  branchIds: string[];
  grantExpiresAt: Date | null;
}>;

/** What the invitation email needs besides the credential. */
export type InvitationMessage = Readonly<{
  acceptUrl: string;
  inviterName: string | null;
}>;

/** Who is acting, with the assurance of the current session. */
export type InvitingActor = Actor &
  Readonly<{ strong: boolean; strongAuthenticatedAt: Date | null }>;

export const invitationTemplate = "organizations.invitation";
const producer = "organizations.invitation";

export function hashCredential(credential: string): Buffer {
  return createHash("sha256").update(credential, "utf8").digest();
}

type InvitingCompany = Readonly<{
  locale: Locale;
  name: string;
  timeZone: string;
}>;

type InvitationRow = {
  id: string;
  recipient_email: string | null;
  role: AccessRole;
  scope: GrantScopeName;
  grant_expires_at: Date | null;
  status: InvitationStatus;
  expired: boolean;
  invited_by_principal_id: string;
  message_id: string | null;
  created_at: Date;
  expires_at: Date;
  decided_at: Date | null;
};

const invitationColumns = Prisma.sql`i.id, i.recipient_email, i.role::text AS role,
  i.scope::text AS scope, i.grant_expires_at, i.status::text AS status,
  (i.status = 'PENDING' AND i.expires_at <= statement_timestamp()) AS expired,
  m.principal_id AS invited_by_principal_id, i.message_id, i.created_at,
  i.expires_at, i.decided_at`;

function visibilityPredicate(visibility: InvitationVisibility): Prisma.Sql {
  if (visibility.kind === "all") return Prisma.sql`TRUE`;
  const branches =
    visibility.branches === "all"
      ? Prisma.sql`TRUE`
      : visibility.branches.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`NOT EXISTS (SELECT 1 FROM company_invitation_branches ib
            WHERE ib.company_id = i.company_id AND ib.invitation_id = i.id
              AND ib.branch_id NOT IN (${Prisma.join(
                visibility.branches.map((id) => Prisma.sql`${id}::uuid`),
              )}))`;
  return Prisma.sql`(i.role = 'OPERATOR' AND i.scope = 'BRANCHES' AND ${branches})`;
}

/**
 * PostgreSQL persistence of company invitations (D-13). Writers lock the
 * company row, then the invitation, then memberships in ID order, and
 * rebuild the actor's access inside the transaction. Each invitation and
 * its email commit together through the mail outbox.
 */
export class PrismaInvitationRepository {
  readonly #db: Database;
  readonly #outbox: MailOutboxPort;

  constructor(database: Database, outbox: MailOutboxPort) {
    this.#db = database;
    this.#outbox = outbox;
  }

  async create(
    actor: InvitingActor,
    companyId: string,
    recipient: string,
    request: GrantRequest,
    message: InvitationMessage,
  ): Promise<InvitationRecord> {
    const id = await this.#db.$transaction(async (tx) => {
      const company = await this.#lockForInviting(
        tx,
        actor,
        companyId,
        request,
      );
      await this.#expirePending(tx, companyId);
      await this.#checkLimits(tx, companyId, recipient, true);
      const [pending] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM company_invitations
        WHERE company_id = ${companyId}::uuid AND status = 'PENDING'
          AND recipient_email = ${recipient}`;
      if (pending) throw new OrganizationFailure("INVITATION_PENDING");
      const created = await this.#insert(
        tx,
        actor,
        companyId,
        recipient,
        request,
        {
          company,
          message,
          replaces: null,
        },
      );
      await writeAudit(tx, companyId, actor, {
        action: "invitation.created",
        targetType: "invitation",
        targetId: created.id,
        details: {
          invitationId: created.id,
          role: request.role,
          scope: request.scope,
          branchCount: request.branchIds.length,
          grantExpiresAt: request.grantExpiresAt?.toISOString() ?? null,
          expiresAt: created.expiresAt.toISOString(),
        },
        branchIds: request.branchIds,
      });
      return created.id;
    });
    this.#outbox.wake();
    return this.#require(companyId, id);
  }

  /** Replaces a pending invitation with a new credential and validity. */
  async resend(
    actor: InvitingActor,
    companyId: string,
    invitationId: string,
    message: InvitationMessage,
  ): Promise<InvitationRecord> {
    const id = await this.#db.$transaction(async (tx) => {
      const current = await this.#lockManaged(
        tx,
        actor,
        companyId,
        invitationId,
      );
      if (current.status !== "PENDING" || current.expired)
        throw new OrganizationFailure("INVITATION_NO_LONGER_VALID");
      const branchIds = (
        await tx.$queryRaw<{ branch_id: string }[]>`
          SELECT branch_id FROM company_invitation_branches
          WHERE company_id = ${companyId}::uuid AND invitation_id = ${invitationId}::uuid
          ORDER BY branch_id`
      ).map((row) => row.branch_id);
      const request: GrantRequest = {
        role: current.role,
        scope: current.scope,
        branchIds,
        grantExpiresAt: current.grant_expires_at,
      };
      const company = await this.#lockForInviting(
        tx,
        actor,
        companyId,
        request,
        {
          archivedBranches: "INVITATION_NO_LONGER_VALID",
        },
      );
      await this.#checkLimits(tx, companyId, current.recipient_email!, false);
      await tx.$executeRaw`
        UPDATE company_invitations SET status = 'REPLACED', decided_at = statement_timestamp()
        WHERE company_id = ${companyId}::uuid AND id = ${invitationId}::uuid`;
      if (current.message_id) await this.#outbox.cancel(tx, current.message_id);
      const created = await this.#insert(
        tx,
        actor,
        companyId,
        current.recipient_email!,
        request,
        { company, message, replaces: invitationId },
      );
      await writeAudit(tx, companyId, actor, {
        action: "invitation.resent",
        targetType: "invitation",
        targetId: created.id,
        details: {
          invitationId: created.id,
          replacedInvitationId: invitationId,
          role: request.role,
          scope: request.scope,
          branchCount: request.branchIds.length,
          expiresAt: created.expiresAt.toISOString(),
        },
        branchIds: request.branchIds,
      });
      return created.id;
    });
    this.#outbox.wake();
    return this.#require(companyId, id);
  }

  /** Revokes a pending invitation; a final one is left unchanged. */
  async revoke(
    actor: InvitingActor,
    companyId: string,
    invitationId: string,
  ): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      const current = await this.#lockManaged(
        tx,
        actor,
        companyId,
        invitationId,
      );
      if (current.status !== "PENDING") return;
      if (current.expired) {
        await this.#expirePending(tx, companyId);
        return;
      }
      await tx.$executeRaw`
        UPDATE company_invitations SET status = 'REVOKED', decided_at = statement_timestamp()
        WHERE company_id = ${companyId}::uuid AND id = ${invitationId}::uuid`;
      if (current.message_id) await this.#outbox.cancel(tx, current.message_id);
      const branches = await tx.$queryRaw<{ branch_id: string }[]>`
        SELECT branch_id FROM company_invitation_branches
        WHERE company_id = ${companyId}::uuid AND invitation_id = ${invitationId}::uuid`;
      await writeAudit(tx, companyId, actor, {
        action: "invitation.revoked",
        targetType: "invitation",
        targetId: invitationId,
        details: { invitationId, role: current.role, scope: current.scope },
        branchIds: branches.map((row) => row.branch_id),
      });
    });
  }

  /** Newest first, keyset-paginated, within the caller's visibility. */
  async list(
    companyId: string,
    visibility: InvitationVisibility,
    options: { limit: number; before?: { createdAt: Date; id: string } },
  ): Promise<InvitationRecord[]> {
    const before = options.before
      ? Prisma.sql`AND (i.created_at, i.id) < (${options.before.createdAt}::timestamptz, ${options.before.id}::uuid)`
      : Prisma.empty;
    const rows = await this.#db.$queryRaw<InvitationRow[]>`
      SELECT ${invitationColumns}
      FROM company_invitations i
      JOIN memberships m ON m.company_id = i.company_id AND m.id = i.invited_by_membership_id
      WHERE i.company_id = ${companyId}::uuid AND ${visibilityPredicate(visibility)} ${before}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ${options.limit}`;
    return this.#withBranches(companyId, rows);
  }

  /** Describes a credential's invitation to the matching recipient. */
  async preview(
    credential: string,
    principalId: string,
    verifiedEmail: string | null,
  ): Promise<InvitationPreview> {
    const [row] = await this.#db.$queryRaw<
      (InvitationRow & {
        company_id: string;
        company_name: string;
        company_status: CompanyStatus;
        accepted_principal_id: string | null;
      })[]
    >`
      SELECT ${invitationColumns}, i.company_id, c.display_name AS company_name,
        c.status::text AS company_status, a.principal_id AS accepted_principal_id
      FROM company_invitations i
      JOIN companies c ON c.id = i.company_id
      JOIN memberships m ON m.company_id = i.company_id AND m.id = i.invited_by_membership_id
      LEFT JOIN memberships a ON a.company_id = i.company_id AND a.id = i.accepted_membership_id
      WHERE i.credential_hash = ${hashCredential(credential)}`;
    if (!row) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    const acceptedByCaller =
      row.status === "ACCEPTED" && row.accepted_principal_id === principalId;
    if (!acceptedByCaller) {
      if (
        row.status !== "PENDING" ||
        row.expired ||
        row.company_status !== "ACTIVE"
      )
        throw new OrganizationFailure("INVITATION_NO_LONGER_VALID");
      if (verifiedEmail === null || verifiedEmail !== row.recipient_email)
        throw new OrganizationFailure("INVITATION_RECIPIENT_MISMATCH");
    }
    const [record] = await this.#withBranches(row.company_id, [row]);
    return {
      companyId: row.company_id,
      companyName: row.company_name,
      role: record.role,
      scope: record.scope,
      branches: record.branches,
      grantExpiresAt: record.grantExpiresAt,
      expiresAt: record.expiresAt,
      invitedByPrincipalId: record.invitedByPrincipalId,
      status: acceptedByCaller ? "ACCEPTED" : "PENDING",
    };
  }

  /**
   * Accepts an invitation for the signed-in principal whose verified email
   * equals the recipient. Repeating an acceptance returns the same result.
   */
  async accept(
    credential: string,
    principalId: string,
    verifiedEmail: string | null,
  ): Promise<{ companyId: string; membershipId: string; replayed: boolean }> {
    const [found] = await this.#db.$queryRaw<
      { id: string; company_id: string }[]
    >`
      SELECT id, company_id FROM company_invitations
      WHERE credential_hash = ${hashCredential(credential)}`;
    if (!found) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    const companyId = found.company_id;
    return this.#db.$transaction(async (tx) => {
      const [company] = await tx.$queryRaw<{ status: CompanyStatus }[]>`
        SELECT status::text AS status FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
      const [invitation] = await tx.$queryRaw<
        (InvitationRow & {
          invited_by_membership_id: string;
          accepted_membership_id: string | null;
        })[]
      >`
        SELECT ${invitationColumns}, i.invited_by_membership_id, i.accepted_membership_id
        FROM company_invitations i
        JOIN memberships m ON m.company_id = i.company_id AND m.id = i.invited_by_membership_id
        WHERE i.company_id = ${companyId}::uuid AND i.id = ${found.id}::uuid
        FOR UPDATE OF i`;
      if (!company || !invitation)
        throw new OrganizationFailure("RESOURCE_NOT_FOUND");
      if (invitation.status === "ACCEPTED") {
        const [accepted] = await tx.$queryRaw<{ principal_id: string }[]>`
          SELECT principal_id FROM memberships
          WHERE company_id = ${companyId}::uuid AND id = ${invitation.accepted_membership_id}::uuid`;
        if (accepted?.principal_id === principalId)
          return {
            companyId,
            membershipId: invitation.accepted_membership_id!,
            replayed: true,
          };
        throw new OrganizationFailure("INVITATION_NO_LONGER_VALID");
      }
      if (
        invitation.status !== "PENDING" ||
        invitation.expired ||
        company.status !== "ACTIVE"
      )
        throw new OrganizationFailure("INVITATION_NO_LONGER_VALID");
      if (
        verifiedEmail === null ||
        verifiedEmail !== invitation.recipient_email
      )
        throw new OrganizationFailure("INVITATION_RECIPIENT_MISMATCH");
      const [existing] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM memberships
        WHERE company_id = ${companyId}::uuid AND principal_id = ${principalId}::uuid
          AND status <> 'REMOVED'`;
      const lockIds = [
        ...new Set(
          [invitation.invited_by_membership_id, existing?.id].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ].sort();
      const locked = await tx.$queryRaw<
        { id: string; principal_id: string; status: MembershipStatus }[]
      >`
        SELECT id, principal_id, status::text AS status FROM memberships
        WHERE company_id = ${companyId}::uuid
          AND id IN (${Prisma.join(lockIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY id FOR UPDATE`;
      const lockedById = new Map(locked.map((row) => [row.id, row]));
      const branchIds = (
        await tx.$queryRaw<{ branch_id: string }[]>`
          SELECT branch_id FROM company_invitation_branches
          WHERE company_id = ${companyId}::uuid AND invitation_id = ${invitation.id}::uuid
          ORDER BY branch_id`
      ).map((row) => row.branch_id);
      // The inviter must still be able to grant exactly this; nothing narrows.
      const inviter = lockedById.get(invitation.invited_by_membership_id);
      const inviterAccess =
        inviter?.status === "ACTIVE"
          ? await accessOf(
              tx,
              companyId,
              inviter.id,
              inviter.principal_id,
              true,
            )
          : null;
      if (
        !inviterAccess ||
        invitationDecision(inviterAccess, {
          role: invitation.role,
          scope: invitation.scope,
          branchIds,
        }) !== "allow"
      )
        throw new OrganizationFailure("INVITATION_NO_LONGER_VALID");
      if (branchIds.length > 0) {
        const active = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM branches WHERE company_id = ${companyId}::uuid AND status = 'ACTIVE'
            AND id IN (${Prisma.join(branchIds.map((id) => Prisma.sql`${id}::uuid`))})
          FOR SHARE`;
        if (active.length !== branchIds.length)
          throw new OrganizationFailure("INVITATION_NO_LONGER_VALID");
      }
      const current = existing ? lockedById.get(existing.id) : undefined;
      if (current?.status === "SUSPENDED")
        throw new OrganizationFailure("MEMBERSHIP_SUSPENDED");
      const membershipId = current?.id ?? randomUUID();
      if (!current)
        await tx.$executeRaw`
          INSERT INTO memberships (id, company_id, principal_id)
          VALUES (${membershipId}::uuid, ${companyId}::uuid, ${principalId}::uuid)`;
      const duplicate = current
        ? await hasIdenticalGrant(tx, companyId, membershipId, {
            role: invitation.role,
            scope: invitation.scope,
            branchIds,
            grantExpiresAt: invitation.grant_expires_at,
          })
        : false;
      if (!duplicate) {
        const grantId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO membership_grants (id, company_id, membership_id, role, scope,
            expires_at, granted_by_membership_id)
          VALUES (${grantId}::uuid, ${companyId}::uuid, ${membershipId}::uuid,
            ${invitation.role}::"AccessRole", ${invitation.scope}::"GrantScope",
            ${invitation.grant_expires_at}::timestamptz,
            ${invitation.invited_by_membership_id}::uuid)`;
        for (const branchId of branchIds)
          await tx.$executeRaw`
            INSERT INTO membership_grant_branches (company_id, grant_id, branch_id)
            VALUES (${companyId}::uuid, ${grantId}::uuid, ${branchId}::uuid)`;
      }
      await tx.$executeRaw`
        UPDATE company_invitations
        SET status = 'ACCEPTED', decided_at = statement_timestamp(),
          accepted_membership_id = ${membershipId}::uuid
        WHERE company_id = ${companyId}::uuid AND id = ${invitation.id}::uuid`;
      await writeAudit(
        tx,
        companyId,
        { principalId, membershipId },
        {
          action: "invitation.accepted",
          targetType: "invitation",
          targetId: invitation.id,
          details: {
            invitationId: invitation.id,
            membershipId,
            newMembership: !current,
            role: invitation.role,
            scope: invitation.scope,
            branchCount: branchIds.length,
          },
          branchIds,
        },
      );
      return { companyId, membershipId, replayed: false };
    });
  }

  /**
   * Retention and lifecycle upkeep, in bounded batches: records expired
   * pending invitations and erases addresses of long-final ones.
   */
  async maintain(limit = 500): Promise<void> {
    await this.#db.$executeRaw`
      UPDATE company_invitations SET status = 'EXPIRED', decided_at = statement_timestamp()
      WHERE id IN (SELECT id FROM company_invitations
        WHERE status = 'PENDING' AND expires_at <= statement_timestamp() LIMIT ${limit})`;
    await this.#db.$executeRaw`
      UPDATE company_invitations SET recipient_email = NULL
      WHERE id IN (SELECT id FROM company_invitations
        WHERE status <> 'PENDING' AND recipient_email IS NOT NULL
          AND decided_at < statement_timestamp() - make_interval(days => ${invitationAddressRetentionDays})
        LIMIT ${limit})`;
  }

  async #require(companyId: string, id: string): Promise<InvitationRecord> {
    const rows = await this.#db.$queryRaw<InvitationRow[]>`
      SELECT ${invitationColumns}
      FROM company_invitations i
      JOIN memberships m ON m.company_id = i.company_id AND m.id = i.invited_by_membership_id
      WHERE i.company_id = ${companyId}::uuid AND i.id = ${id}::uuid`;
    const [record] = await this.#withBranches(companyId, rows);
    if (!record) throw new Error("Invitation is not readable");
    return record;
  }

  async #withBranches(
    companyId: string,
    rows: readonly InvitationRow[],
  ): Promise<InvitationRecord[]> {
    const ids = rows.map((row) => row.id);
    const branches =
      ids.length === 0
        ? []
        : await this.#db.$queryRaw<
            { invitation_id: string; id: string; name: string }[]
          >`
            SELECT ib.invitation_id, b.id, b.name
            FROM company_invitation_branches ib
            JOIN branches b ON b.company_id = ib.company_id AND b.id = ib.branch_id
            WHERE ib.company_id = ${companyId}::uuid
              AND ib.invitation_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
            ORDER BY lower(b.name), b.id`;
    return rows.map((row) => ({
      id: row.id,
      recipientEmail: row.recipient_email,
      role: row.role,
      scope: row.scope,
      branches: branches
        .filter((branch) => branch.invitation_id === row.id)
        .map(({ id, name }) => ({ id, name })),
      grantExpiresAt: row.grant_expires_at,
      status: row.expired ? "EXPIRED" : row.status,
      invitedByPrincipalId: row.invited_by_principal_id,
      messageId: row.message_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
    }));
  }

  /**
   * Locks the company and the actor's membership, rebuilds the actor's
   * access and decides the grant request; validates its branches and expiry.
   */
  async #lockForInviting(
    tx: Prisma.TransactionClient,
    actor: InvitingActor,
    companyId: string,
    request: GrantRequest,
    options: {
      archivedBranches?: "VALIDATION_FAILED" | "INVITATION_NO_LONGER_VALID";
    } = {},
  ): Promise<InvitingCompany> {
    const [company] = await tx.$queryRaw<
      {
        status: CompanyStatus;
        default_locale: Locale;
        display_name: string;
        time_zone: string;
      }[]
    >`
      SELECT status::text AS status, default_locale, display_name, time_zone FROM companies
      WHERE id = ${companyId}::uuid FOR UPDATE`;
    if (!company) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    await this.#requireActiveMember(tx, actor, companyId);
    if (company.status !== "ACTIVE")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const access = await accessOf(
      tx,
      companyId,
      actor.membershipId,
      actor.principalId,
      actor.strong,
    );
    const decision = invitationDecision(access, request);
    if (decision === "strong_required")
      throw new OrganizationFailure("STRONG_AUTHENTICATION_REQUIRED");
    if (decision === "responsible_required")
      throw new OrganizationFailure("RESPONSIBLE_APPROVAL_REQUIRED");
    if (decision === "deny") throw new OrganizationFailure("PERMISSION_DENIED");
    if (request.role === "COMPANY_ADMINISTRATOR")
      await requireRecent(tx, actor.strongAuthenticatedAt);
    if (request.grantExpiresAt) {
      const [future] = await tx.$queryRaw<{ valid: boolean }[]>`
        SELECT ${request.grantExpiresAt}::timestamptz > statement_timestamp() + interval '1 minute' AS valid`;
      if (!future?.valid) throw new OrganizationFailure("VALIDATION_FAILED");
    }
    if (request.branchIds.length > 0) {
      // Unknown, archived and other companies' branches are rejected alike.
      const active = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM branches WHERE company_id = ${companyId}::uuid AND status = 'ACTIVE'
          AND id IN (${Prisma.join(request.branchIds.map((id) => Prisma.sql`${id}::uuid`))})
        FOR SHARE`;
      if (active.length !== request.branchIds.length)
        throw new OrganizationFailure(
          options.archivedBranches ?? "VALIDATION_FAILED",
        );
    }
    return {
      locale: company.default_locale,
      name: company.display_name,
      timeZone: company.time_zone,
    };
  }

  async #requireActiveMember(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
  ): Promise<void> {
    const [member] = await tx.$queryRaw<
      { principal_id: string; status: MembershipStatus }[]
    >`
      SELECT principal_id, status::text AS status FROM memberships
      WHERE company_id = ${companyId}::uuid AND id = ${actor.membershipId}::uuid
      FOR UPDATE`;
    if (
      !member ||
      member.principal_id !== actor.principalId ||
      member.status !== "ACTIVE"
    )
      throw new OrganizationFailure("RESOURCE_NOT_FOUND");
  }

  /**
   * Locks the company, rebuilds the actor's current access, locks the
   * invitation if the actor may manage it, then rechecks the actor's
   * membership: company, invitation, membership, as rule 5 requires.
   */
  async #lockManaged(
    tx: Prisma.TransactionClient,
    actor: InvitingActor,
    companyId: string,
    invitationId: string,
  ): Promise<InvitationRow> {
    const [company] = await tx.$queryRaw<{ status: CompanyStatus }[]>`
      SELECT status::text AS status FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
    if (!company) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    if (company.status !== "ACTIVE")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    const access = await accessOf(
      tx,
      companyId,
      actor.membershipId,
      actor.principalId,
      actor.strong,
    );
    const visibility = invitationVisibility(access);
    if (!visibility)
      throw new OrganizationFailure(
        !actor.strong &&
          reachableWithStrongAuthentication(access, "invitations.manage")
          ? "STRONG_AUTHENTICATION_REQUIRED"
          : "PERMISSION_DENIED",
      );
    const row = await this.#lockVisible(
      tx,
      companyId,
      invitationId,
      visibility,
    );
    await this.#requireActiveMember(tx, actor, companyId);
    return row;
  }

  async #lockVisible(
    tx: Prisma.TransactionClient,
    companyId: string,
    invitationId: string,
    visibility: InvitationVisibility,
  ): Promise<InvitationRow> {
    const [row] = await tx.$queryRaw<InvitationRow[]>`
      SELECT ${invitationColumns}
      FROM company_invitations i
      JOIN memberships m ON m.company_id = i.company_id AND m.id = i.invited_by_membership_id
      WHERE i.company_id = ${companyId}::uuid AND i.id = ${invitationId}::uuid
        AND ${visibilityPredicate(visibility)}
      FOR UPDATE OF i`;
    if (!row) throw new OrganizationFailure("RESOURCE_NOT_FOUND");
    return row;
  }

  async #expirePending(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE company_invitations SET status = 'EXPIRED', decided_at = statement_timestamp()
      WHERE company_id = ${companyId}::uuid AND status = 'PENDING'
        AND expires_at <= statement_timestamp()`;
  }

  async #checkLimits(
    tx: Prisma.TransactionClient,
    companyId: string,
    recipient: string,
    adding: boolean,
  ): Promise<void> {
    const [counts] = await tx.$queryRaw<
      { recent: number; pending: number; recipient: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM company_invitations WHERE company_id = ${companyId}::uuid
          AND created_at > statement_timestamp() - interval '24 hours') AS recent,
        (SELECT count(*)::int FROM company_invitations WHERE company_id = ${companyId}::uuid
          AND status = 'PENDING') AS pending,
        (SELECT count(*)::int FROM company_invitations WHERE recipient_email = ${recipient}
          AND created_at > statement_timestamp() - interval '24 hours') AS recipient`;
    if (
      !counts ||
      counts.recent >= invitationLimits.perCompanyPerDay ||
      (adding && counts.pending >= invitationLimits.pendingPerCompany) ||
      counts.recipient >= invitationLimits.perRecipientPerDay
    )
      throw new OrganizationFailure("RATE_LIMITED");
  }

  async #insert(
    tx: Prisma.TransactionClient,
    actor: Actor,
    companyId: string,
    recipient: string,
    request: GrantRequest,
    options: {
      company: InvitingCompany;
      message: InvitationMessage;
      replaces: string | null;
    },
  ): Promise<{ id: string; expiresAt: Date }> {
    const id = randomUUID();
    const credential = randomBytes(32).toString("base64url");
    const [timing] = await tx.$queryRaw<{ now: Date; expires: Date }[]>`
      SELECT statement_timestamp() AS now,
        statement_timestamp() + make_interval(days => ${invitationDays}) AS expires`;
    const messageId = await this.#outbox.enqueue(tx, {
      producer,
      producerReference: id,
      template: invitationTemplate,
      locale: options.company.locale,
      recipient,
      parameters: {
        acceptUrl: options.message.acceptUrl,
        companyName: options.company.name,
        inviterName: options.message.inviterName ?? "",
        role: request.role,
        expiresAt: timing.expires.toISOString(),
        timeZone: options.company.timeZone,
      },
      secret: credential,
    });
    await tx.$executeRaw`
      INSERT INTO company_invitations (id, company_id, recipient_email, credential_hash,
        role, scope, grant_expires_at, invited_by_membership_id, message_id,
        replaces_invitation_id, created_at, expires_at)
      VALUES (${id}::uuid, ${companyId}::uuid, ${recipient}, ${hashCredential(credential)},
        ${request.role}::"AccessRole", ${request.scope}::"GrantScope",
        ${request.grantExpiresAt}::timestamptz, ${actor.membershipId}::uuid,
        ${messageId}::uuid, ${options.replaces}::uuid, ${timing.now}::timestamptz,
        ${timing.expires}::timestamptz)`;
    for (const branchId of request.branchIds)
      await tx.$executeRaw`
        INSERT INTO company_invitation_branches (company_id, invitation_id, branch_id)
        VALUES (${companyId}::uuid, ${id}::uuid, ${branchId}::uuid)`;
    return { id, expiresAt: timing.expires };
  }
}

/** Effective access of a membership, read inside the caller's transaction. */
async function accessOf(
  tx: Prisma.TransactionClient,
  companyId: string,
  membershipId: string,
  principalId: string,
  strong: boolean,
): Promise<CompanyAccess> {
  const rows = await tx.$queryRaw<
    ({ company_status: CompanyStatus; responsible: boolean } & GrantAccessRow)[]
  >`
    SELECT c.status::text AS company_status,
      COALESCE(r.membership_id = m.id, false) AS responsible, ${grantAccessColumns}
    FROM memberships m
    JOIN companies c ON c.id = m.company_id
    LEFT JOIN company_responsibilities r ON r.company_id = m.company_id
    LEFT JOIN membership_grants g ON g.company_id = m.company_id AND g.membership_id = m.id
      AND g.revoked_at IS NULL AND g.starts_at <= statement_timestamp()
      AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())
    ${grantAccessJoins}
    WHERE m.company_id = ${companyId}::uuid AND m.id = ${membershipId}::uuid`;
  return companyAccess({
    companyId,
    companyStatus: rows[0]?.company_status ?? "SUSPENDED",
    membershipId,
    principalId,
    responsible: rows[0]?.responsible ?? false,
    grants: grantsFromRows(rows),
    strong,
  });
}

async function hasIdenticalGrant(
  tx: Prisma.TransactionClient,
  companyId: string,
  membershipId: string,
  request: GrantRequest,
): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { id: string; expires_at: Date | null; branches: string[] }[]
  >`
    SELECT g.id, g.expires_at,
      COALESCE(array_agg(gb.branch_id::text ORDER BY gb.branch_id) FILTER (WHERE gb.branch_id IS NOT NULL), '{}') AS branches
    FROM membership_grants g
    LEFT JOIN membership_grant_branches gb ON gb.company_id = g.company_id AND gb.grant_id = g.id
    WHERE g.company_id = ${companyId}::uuid AND g.membership_id = ${membershipId}::uuid
      AND g.role = ${request.role}::"AccessRole" AND g.scope = ${request.scope}::"GrantScope"
      AND g.revoked_at IS NULL AND g.starts_at <= statement_timestamp()
      AND (g.expires_at IS NULL OR g.expires_at > statement_timestamp())
    GROUP BY g.id, g.expires_at`;
  const wanted = [...request.branchIds].sort().join(",");
  return rows.some(
    (row) =>
      (row.expires_at?.getTime() ?? null) ===
        (request.grantExpiresAt?.getTime() ?? null) &&
      [...row.branches].sort().join(",") === wanted,
  );
}
