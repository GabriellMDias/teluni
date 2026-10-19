-- Reviewed company invitations (D-13). An invitation carries one grant
-- request, is bound to a lower-cased recipient address, stores only the
-- SHA-256 hash of its credential and is valid for seven days; resend
-- replaces it. Acceptance by the matching verified identity creates or
-- extends a membership. A removed membership stays as history, so one
-- principal may hold a new membership in the same company after removal.
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'REPLACED', 'EXPIRED');

DROP INDEX "memberships_company_principal_key";
-- One current membership per principal and company; REMOVED ones are history.
CREATE UNIQUE INDEX "memberships_company_principal_current_key" ON "memberships"("company_id", "principal_id") WHERE "status" <> 'REMOVED';

CREATE TABLE "company_invitations" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "recipient_email" VARCHAR(254),
  "credential_hash" BYTEA NOT NULL,
  "role" "AccessRole" NOT NULL,
  "scope" "GrantScope" NOT NULL,
  "grant_expires_at" TIMESTAMPTZ(3),
  "invited_by_membership_id" UUID NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "message_id" UUID,
  "replaces_invitation_id" UUID,
  "accepted_membership_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "decided_at" TIMESTAMPTZ(3),
  CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "company_invitations_company_id_invited_by_membership_id_fkey" FOREIGN KEY ("company_id", "invited_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "company_invitations_company_id_accepted_membership_id_fkey" FOREIGN KEY ("company_id", "accepted_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "company_invitations_credential_hash_length" CHECK (octet_length("credential_hash") = 32),
  CONSTRAINT "company_invitations_recipient_normalized" CHECK ("recipient_email" = lower(btrim("recipient_email"))),
  CONSTRAINT "company_invitations_pending_recipient" CHECK ("status" <> 'PENDING' OR "recipient_email" IS NOT NULL),
  CONSTRAINT "company_invitations_administrator_company_wide" CHECK ("role" <> 'COMPANY_ADMINISTRATOR' OR "scope" = 'COMPANY'),
  CONSTRAINT "company_invitations_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "company_invitations_grant_expiry_after_creation" CHECK ("grant_expires_at" IS NULL OR "grant_expires_at" > "created_at"),
  CONSTRAINT "company_invitations_decision_state" CHECK (("status" = 'PENDING') = ("decided_at" IS NULL)),
  CONSTRAINT "company_invitations_acceptance_state" CHECK (("status" = 'ACCEPTED') = ("accepted_membership_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "company_invitations_company_id_id_key" ON "company_invitations"("company_id", "id");
-- A resend references the invitation it replaced, through the tenant key.
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_company_id_replaces_invitation_id_fkey" FOREIGN KEY ("company_id", "replaces_invitation_id") REFERENCES "company_invitations"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "company_invitations_credential_key" ON "company_invitations"("credential_hash");
CREATE INDEX "company_invitations_company_time_idx" ON "company_invitations"("company_id", "created_at" DESC, "id" DESC);
CREATE INDEX "company_invitations_recipient_idx" ON "company_invitations"("recipient_email", "created_at");
-- One pending invitation per company and recipient address, including racing requests.
CREATE UNIQUE INDEX "company_invitations_one_pending" ON "company_invitations"("company_id", "recipient_email") WHERE "status" = 'PENDING';

CREATE TABLE "company_invitation_branches" (
  "company_id" UUID NOT NULL,
  "invitation_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  CONSTRAINT "company_invitation_branches_pkey" PRIMARY KEY ("invitation_id", "branch_id"),
  CONSTRAINT "company_invitation_branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "company_invitation_branches_company_id_invitation_id_fkey" FOREIGN KEY ("company_id", "invitation_id") REFERENCES "company_invitations"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "company_invitation_branches_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "company_invitation_branches_branch_idx" ON "company_invitation_branches"("company_id", "branch_id");
