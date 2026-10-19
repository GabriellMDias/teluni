-- Reviewed device enrollment and lifecycle (D-03 server side, ADR-0027). A
-- player starts an enrollment with the SHA-256 of a credential it generated
-- and shows a short code; the code is stored only as an HMAC. An authorized
-- person claims the code, which creates the device in one company and branch.
-- The device then authenticates with the credential, whose hash the device
-- row keeps until erasure is confirmed. Unlink revokes the device and leaves
-- erasure PENDING until the device confirms clearing or a person records a
-- controlled reset.
CREATE TYPE "DeviceEnrollmentStatus" AS ENUM ('PENDING', 'CLAIMED');
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "DeviceErasure" AS ENUM ('NONE', 'PENDING', 'CONFIRMED', 'RESET_RECORDED');

CREATE TABLE "devices" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "enrollment_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "rotation" INTEGER NOT NULL,
  "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
  "erasure" "DeviceErasure" NOT NULL DEFAULT 'NONE',
  "credential_hash" BYTEA,
  "next_credential_hash" BYTEA,
  "report" JSONB NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3),
  "paired_by_membership_id" UUID NOT NULL,
  "paired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  "erasure_recorded_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "devices_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "devices_company_id_paired_by_membership_id_fkey" FOREIGN KEY ("company_id", "paired_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "devices_name_trimmed" CHECK ("name" = btrim("name") AND char_length("name") >= 1),
  CONSTRAINT "devices_rotation_valid" CHECK ("rotation" IN (0, 90, 180, 270)),
  CONSTRAINT "devices_credential_hash_length" CHECK ("credential_hash" IS NULL OR octet_length("credential_hash") = 32),
  CONSTRAINT "devices_next_credential_hash_length" CHECK ("next_credential_hash" IS NULL OR octet_length("next_credential_hash") = 32),
  CONSTRAINT "devices_next_credential_distinct" CHECK ("next_credential_hash" IS NULL OR "next_credential_hash" <> "credential_hash"),
  CONSTRAINT "devices_report_object" CHECK (jsonb_typeof("report") = 'object'),
  CONSTRAINT "devices_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "devices_active_state" CHECK (("status" = 'ACTIVE') = ("erasure" = 'NONE')),
  CONSTRAINT "devices_active_credential" CHECK ("status" <> 'ACTIVE' OR "credential_hash" IS NOT NULL),
  CONSTRAINT "devices_revocation_state" CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL)),
  CONSTRAINT "devices_rotation_pending_only_active" CHECK ("status" = 'ACTIVE' OR "next_credential_hash" IS NULL),
  CONSTRAINT "devices_confirmed_without_credential" CHECK ("erasure" <> 'CONFIRMED' OR "credential_hash" IS NULL),
  CONSTRAINT "devices_erasure_recorded_state" CHECK (("erasure" IN ('CONFIRMED', 'RESET_RECORDED')) = ("erasure_recorded_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "devices_company_id_id_key" ON "devices"("company_id", "id");
-- The enrollment a device was claimed from; enrollments are purged later, so
-- this is a plain identifier rather than a reference.
CREATE UNIQUE INDEX "devices_enrollment_key" ON "devices"("enrollment_id");
CREATE UNIQUE INDEX "devices_credential_key" ON "devices"("credential_hash");
CREATE UNIQUE INDEX "devices_next_credential_key" ON "devices"("next_credential_hash");
CREATE INDEX "devices_company_branch_status_idx" ON "devices"("company_id", "branch_id", "status");
CREATE INDEX "devices_company_paired_idx" ON "devices"("company_id", "paired_at" DESC, "id" DESC);

CREATE TABLE "device_enrollments" (
  "id" UUID NOT NULL,
  "credential_hash" BYTEA NOT NULL,
  "code_hmac" BYTEA NOT NULL,
  "code_key_id" VARCHAR(32) NOT NULL,
  "report" JSONB NOT NULL,
  "status" "DeviceEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "last_polled_at" TIMESTAMPTZ(3),
  "claimed_at" TIMESTAMPTZ(3),
  CONSTRAINT "device_enrollments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_enrollments_credential_hash_length" CHECK (octet_length("credential_hash") = 32),
  CONSTRAINT "device_enrollments_code_hmac_length" CHECK (octet_length("code_hmac") = 32),
  CONSTRAINT "device_enrollments_report_object" CHECK (jsonb_typeof("report") = 'object'),
  CONSTRAINT "device_enrollments_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "device_enrollments_claim_state" CHECK (("status" = 'CLAIMED') = ("claimed_at" IS NOT NULL))
);
-- One credential binds at most one identity, and live codes never collide.
CREATE UNIQUE INDEX "device_enrollments_credential_key" ON "device_enrollments"("credential_hash");
CREATE UNIQUE INDEX "device_enrollments_code_key" ON "device_enrollments"("code_hmac");
CREATE INDEX "device_enrollments_status_expiry_idx" ON "device_enrollments"("status", "expires_at");

CREATE TABLE "device_claim_failures" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "principal_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_claim_failures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_claim_failures_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "device_claim_failures_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "device_claim_failures_company_id_id_key" ON "device_claim_failures"("company_id", "id");
CREATE INDEX "device_claim_failures_principal_time_idx" ON "device_claim_failures"("principal_id", "occurred_at");
CREATE INDEX "device_claim_failures_company_time_idx" ON "device_claim_failures"("company_id", "occurred_at");

CREATE TABLE "device_audit_events" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_principal_id" UUID,
  "actor_membership_id" UUID,
  "action" VARCHAR(64) NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "device_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "device_audit_events_company_id_device_id_fkey" FOREIGN KEY ("company_id", "device_id") REFERENCES "devices"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "device_audit_events_actor_principal_id_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "device_audit_events_company_id_actor_membership_id_fkey" FOREIGN KEY ("company_id", "actor_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "device_audit_events_details_object" CHECK (jsonb_typeof("details") = 'object'),
  -- Device-initiated events (erasure confirmation) have no human actor.
  CONSTRAINT "device_audit_events_actor_pair" CHECK (("actor_principal_id" IS NULL) = ("actor_membership_id" IS NULL))
);
CREATE UNIQUE INDEX "device_audit_events_company_id_id_key" ON "device_audit_events"("company_id", "id");
CREATE INDEX "device_audit_events_device_time_idx" ON "device_audit_events"("company_id", "device_id", "occurred_at" DESC, "id" DESC);
