-- Reviewed organizations schema (docs/project/tenant-data-design.md): the
-- company is the tenant; every tenant-owned table has a (company_id, id) key
-- and every tenant reference is composite. PostgreSQL owns the clock.
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "AccessRole" AS ENUM ('COMPANY_ADMINISTRATOR', 'BRANCH_MANAGER', 'OPERATOR');
CREATE TYPE "GrantScope" AS ENUM ('COMPANY', 'BRANCHES');

CREATE TABLE "companies" (
  "id" UUID NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
  "default_locale" VARCHAR(10) NOT NULL,
  "time_zone" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_principal_id" UUID NOT NULL,
  "creation_key" VARCHAR(200) NOT NULL,
  "creation_fingerprint" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companies_created_by_principal_id_fkey" FOREIGN KEY ("created_by_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "companies_display_name_nonblank" CHECK ("display_name" ~ '[^[:space:]]'),
  CONSTRAINT "companies_default_locale_supported" CHECK ("default_locale" IN ('pt-BR', 'en-US')),
  CONSTRAINT "companies_time_zone_nonblank" CHECK ("time_zone" ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'),
  CONSTRAINT "companies_version_positive" CHECK ("version" > 0),
  CONSTRAINT "companies_creation_key_format" CHECK ("creation_key" ~ '^[A-Za-z0-9._~-]+$'),
  CONSTRAINT "companies_creation_fingerprint_format" CHECK ("creation_fingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "companies_creator_key_unique" ON "companies"("created_by_principal_id", "creation_key");

CREATE TABLE "branches" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "time_zone" VARCHAR(64) NOT NULL,
  "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "branches_name_nonblank" CHECK ("name" ~ '[^[:space:]]'),
  CONSTRAINT "branches_time_zone_nonblank" CHECK ("time_zone" ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'),
  CONSTRAINT "branches_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "branches_company_id_id_key" ON "branches"("company_id", "id");
CREATE INDEX "branches_company_status_name_idx" ON "branches"("company_id", "status", "name");
-- Active branch names are unique within a company, ignoring case.
CREATE UNIQUE INDEX "branches_company_active_name_unique" ON "branches"("company_id", lower("name")) WHERE "status" = 'ACTIVE';

CREATE TABLE "memberships" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "principal_id" UUID NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "memberships_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "memberships_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "memberships_company_id_id_key" ON "memberships"("company_id", "id");
CREATE UNIQUE INDEX "memberships_company_principal_key" ON "memberships"("company_id", "principal_id");
CREATE INDEX "memberships_principal_status_idx" ON "memberships"("principal_id", "status");

CREATE TABLE "company_responsibilities" (
  "company_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_responsibilities_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "company_responsibilities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "company_responsibilities_company_id_membership_id_fkey" FOREIGN KEY ("company_id", "membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "company_responsibilities_membership_key" ON "company_responsibilities"("company_id", "membership_id");

CREATE TABLE "membership_grants" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "role" "AccessRole" NOT NULL,
  "scope" "GrantScope" NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3),
  "granted_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "membership_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "membership_grants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "membership_grants_company_id_membership_id_fkey" FOREIGN KEY ("company_id", "membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "membership_grants_company_id_granted_by_membership_id_fkey" FOREIGN KEY ("company_id", "granted_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "membership_grants_expiry_after_start" CHECK ("expires_at" IS NULL OR "expires_at" > "starts_at"),
  CONSTRAINT "membership_grants_company_role_scope" CHECK ("role" <> 'COMPANY_ADMINISTRATOR' OR "scope" = 'COMPANY')
);
CREATE UNIQUE INDEX "membership_grants_company_id_id_key" ON "membership_grants"("company_id", "id");
CREATE INDEX "membership_grants_membership_idx" ON "membership_grants"("company_id", "membership_id");

CREATE TABLE "membership_grant_branches" (
  "company_id" UUID NOT NULL,
  "grant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  CONSTRAINT "membership_grant_branches_pkey" PRIMARY KEY ("grant_id", "branch_id"),
  CONSTRAINT "membership_grant_branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "membership_grant_branches_company_id_grant_id_fkey" FOREIGN KEY ("company_id", "grant_id") REFERENCES "membership_grants"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "membership_grant_branches_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "membership_grant_branches_branch_idx" ON "membership_grant_branches"("company_id", "branch_id");

CREATE TABLE "organization_audit_events" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_principal_id" UUID NOT NULL,
  "actor_membership_id" UUID,
  "action" VARCHAR(64) NOT NULL,
  "target_type" VARCHAR(32) NOT NULL,
  "target_id" UUID NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "organization_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "organization_audit_events_actor_principal_id_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "organization_audit_events_company_id_actor_membership_id_fkey" FOREIGN KEY ("company_id", "actor_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "organization_audit_events_action_format" CHECK ("action" ~ '^[a-z]+(\.[a-z_]+)+$'),
  CONSTRAINT "organization_audit_events_target_type_format" CHECK ("target_type" ~ '^[a-z_]+$'),
  CONSTRAINT "organization_audit_events_details_object" CHECK (jsonb_typeof("details") = 'object')
);
CREATE UNIQUE INDEX "organization_audit_events_company_id_id_key" ON "organization_audit_events"("company_id", "id");
CREATE INDEX "organization_audit_events_company_time_idx" ON "organization_audit_events"("company_id", "occurred_at" DESC, "id" DESC);
