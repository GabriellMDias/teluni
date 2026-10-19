import { isEmailAddress, normalizeEmailAddress } from "../../email-address.js";
import type { HumanContext, HumanProfilePort } from "../identity/public.js";
import type { DeliveryState, MailOutboxPort } from "../mail/public.js";
import {
  grantRequest,
  invitationDecision,
  invitationVisibility,
  OrganizationFailure,
  reachableWithStrongAuthentication,
  type AccessRole,
  type CompanyAccess,
  type GrantScopeName,
  type InvitationVisibility,
} from "./domain.js";
import type {
  InvitationRecord,
  InvitingActor,
  PrismaInvitationRepository,
} from "./invitation-repository.js";
import type { CompanyAccessPort } from "./public.js";
import { decodeCursor, encodeCursor } from "./service.js";

export type InvitationView = Readonly<
  Omit<InvitationRecord, "messageId" | "invitedByPrincipalId" | "decidedAt"> & {
    delivery: DeliveryState | null;
    invitedByName: string | null;
  }
>;

function actorOf(context: HumanContext, access: CompanyAccess): InvitingActor {
  return {
    principalId: context.principalId,
    membershipId: access.membershipId,
    strong: access.strong,
    strongAuthenticatedAt: context.strongAuthenticatedAt,
  };
}

function visibilityScope(visibility: InvitationVisibility): string {
  return visibility.kind === "all"
    ? "all"
    : visibility.branches === "all"
      ? "operators:all"
      : `operators:${visibility.branches.join(",")}`;
}

/** Company invitations (D-13) over the organizations access boundary. */
export class InvitationService {
  readonly #repository: PrismaInvitationRepository;
  readonly #companies: CompanyAccessPort;
  readonly #profiles: HumanProfilePort;
  readonly #outbox: MailOutboxPort;
  readonly #acceptUrl: string;

  constructor(options: {
    repository: PrismaInvitationRepository;
    companies: CompanyAccessPort;
    profiles: HumanProfilePort;
    outbox: MailOutboxPort;
    publicOrigin: string;
  }) {
    this.#repository = options.repository;
    this.#companies = options.companies;
    this.#profiles = options.profiles;
    this.#outbox = options.outbox;
    this.#acceptUrl = `${options.publicOrigin}/invitations/accept`;
  }

  async create(
    context: HumanContext,
    companyId: string,
    input: {
      email: string;
      role: AccessRole;
      scope: GrantScopeName;
      branchIds?: string[];
      grantExpiresAt?: string;
    },
  ): Promise<InvitationView> {
    const access = await this.#activeAccess(context, companyId);
    const recipient = normalizeEmailAddress(input.email);
    if (!isEmailAddress(recipient))
      throw new OrganizationFailure("VALIDATION_FAILED");
    const request = grantRequest(input);
    const grantExpiresAt =
      input.grantExpiresAt === undefined
        ? null
        : new Date(input.grantExpiresAt);
    if (grantExpiresAt && Number.isNaN(grantExpiresAt.getTime()))
      throw new OrganizationFailure("VALIDATION_FAILED");
    this.#decide(access, request);
    const record = await this.#repository.create(
      actorOf(context, access),
      companyId,
      recipient,
      { ...request, grantExpiresAt },
      { acceptUrl: this.#acceptUrl, inviterName: await this.#nameOf(context) },
    );
    return (await this.#views([record]))[0];
  }

  async list(
    context: HumanContext,
    companyId: string,
    options: { limit: number; cursor?: string },
  ): Promise<{ items: InvitationView[]; nextCursor: string | null }> {
    const access = await this.#activeAccess(context, companyId);
    const visibility = this.#visibility(access);
    const scope = visibilityScope(visibility);
    const cursor = decodeCursor(options.cursor, {
      company: companyId,
      principal: context.principalId,
      kind: "invitations",
      scope,
    });
    const rows = await this.#repository.list(companyId, visibility, {
      limit: options.limit + 1,
      ...(cursor
        ? { before: { createdAt: new Date(cursor.t), id: cursor.i } }
        : {}),
    });
    const page = rows.slice(0, options.limit);
    const last = page.at(-1);
    return {
      items: await this.#views(page),
      nextCursor:
        rows.length > options.limit && last
          ? encodeCursor({
              c: companyId,
              p: context.principalId,
              k: "invitations",
              r: scope,
              t: last.createdAt.toISOString(),
              i: last.id,
            })
          : null,
    };
  }

  async resend(
    context: HumanContext,
    companyId: string,
    invitationId: string,
  ): Promise<InvitationView> {
    const access = await this.#activeAccess(context, companyId);
    this.#visibility(access);
    const record = await this.#repository.resend(
      actorOf(context, access),
      companyId,
      invitationId,
      { acceptUrl: this.#acceptUrl, inviterName: await this.#nameOf(context) },
    );
    return (await this.#views([record]))[0];
  }

  async revoke(
    context: HumanContext,
    companyId: string,
    invitationId: string,
  ): Promise<void> {
    const access = await this.#activeAccess(context, companyId);
    this.#visibility(access);
    await this.#repository.revoke(
      actorOf(context, access),
      companyId,
      invitationId,
    );
  }

  async preview(context: HumanContext, credential: string) {
    const preview = await this.#repository.preview(
      credential,
      context.principalId,
      await this.#verifiedEmailOf(context),
    );
    const [inviter] = await this.#profiles.getMany([
      preview.invitedByPrincipalId,
    ]);
    const { invitedByPrincipalId: _inviter, ...visible } = preview;
    void _inviter;
    return { ...visible, invitedByName: inviter?.displayName ?? null };
  }

  async accept(context: HumanContext, credential: string) {
    return this.#repository.accept(
      credential,
      context.principalId,
      await this.#verifiedEmailOf(context),
    );
  }

  /** Upkeep the mail dispatcher runs with its own maintenance. */
  maintain(): Promise<void> {
    return this.#repository.maintain();
  }

  async #activeAccess(
    context: HumanContext,
    companyId: string,
  ): Promise<CompanyAccess> {
    const access = await this.#companies.resolve(context, companyId);
    if (access.companyStatus === "SUSPENDED")
      throw new OrganizationFailure("COMPANY_SUSPENDED");
    return access;
  }

  /** Request-time check; the repository decides again inside its transaction. */
  #decide(
    access: CompanyAccess,
    request: { role: AccessRole; scope: GrantScopeName; branchIds: string[] },
  ): void {
    const decision = invitationDecision(access, request);
    if (decision === "strong_required")
      throw new OrganizationFailure("STRONG_AUTHENTICATION_REQUIRED");
    if (decision === "responsible_required")
      throw new OrganizationFailure("RESPONSIBLE_APPROVAL_REQUIRED");
    if (decision === "deny") throw new OrganizationFailure("PERMISSION_DENIED");
  }

  #visibility(access: CompanyAccess): InvitationVisibility {
    const visibility = invitationVisibility(access);
    if (visibility) return visibility;
    throw new OrganizationFailure(
      !access.strong &&
        reachableWithStrongAuthentication(access, "invitations.manage")
        ? "STRONG_AUTHENTICATION_REQUIRED"
        : "PERMISSION_DENIED",
    );
  }

  async #nameOf(context: HumanContext): Promise<string | null> {
    const [profile] = await this.#profiles.getMany([context.principalId]);
    return profile?.displayName ?? null;
  }

  /** The verified address from the principal's latest verified sign-in. */
  async #verifiedEmailOf(context: HumanContext): Promise<string | null> {
    const [profile] = await this.#profiles.getMany([context.principalId]);
    return profile?.email ? normalizeEmailAddress(profile.email) : null;
  }

  async #views(
    records: readonly InvitationRecord[],
  ): Promise<InvitationView[]> {
    const messageIds = records
      .map((record) => record.messageId)
      .filter((id): id is string => id !== null);
    const [states, profiles] = await Promise.all([
      this.#outbox.states(messageIds),
      this.#profiles.getMany([
        ...new Set(records.map((record) => record.invitedByPrincipalId)),
      ]),
    ]);
    const names = new Map(
      profiles.map((profile) => [profile.principalId, profile.displayName]),
    );
    return records.map(
      ({ messageId, invitedByPrincipalId, decidedAt: _decided, ...record }) => {
        void _decided;
        return {
          ...record,
          delivery: messageId ? (states.get(messageId) ?? null) : null,
          invitedByName: names.get(invitedByPrincipalId) ?? null,
        };
      },
    );
  }
}
