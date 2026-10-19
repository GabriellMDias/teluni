-- Reviewed role administration and responsibility transfer (P10/P14/P30).
-- Grants are revoked, never deleted; a responsibility transfer is proposed
-- by the responsible administrator and takes effect only when the
-- successor accepts. At most one transfer per company is pending.
CREATE TYPE "ResponsibilityTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "responsibility_transfers" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "from_membership_id" UUID NOT NULL,
  "to_membership_id" UUID NOT NULL,
  "status" "ResponsibilityTransferStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "decided_at" TIMESTAMPTZ(3),
  CONSTRAINT "responsibility_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "responsibility_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "responsibility_transfers_company_id_from_membership_id_fkey" FOREIGN KEY ("company_id", "from_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "responsibility_transfers_company_id_to_membership_id_fkey" FOREIGN KEY ("company_id", "to_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "responsibility_transfers_distinct_parties" CHECK ("from_membership_id" <> "to_membership_id"),
  CONSTRAINT "responsibility_transfers_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "responsibility_transfers_decision_state" CHECK (("status" = 'PENDING') = ("decided_at" IS NULL))
);
CREATE UNIQUE INDEX "responsibility_transfers_company_id_id_key" ON "responsibility_transfers"("company_id", "id");
CREATE INDEX "responsibility_transfers_successor_idx" ON "responsibility_transfers"("company_id", "to_membership_id");
-- One pending transfer per company, including racing proposals.
CREATE UNIQUE INDEX "responsibility_transfers_one_pending" ON "responsibility_transfers"("company_id") WHERE "status" = 'PENDING';
