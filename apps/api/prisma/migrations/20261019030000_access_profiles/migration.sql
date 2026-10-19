-- Reviewed company-customized access profiles (ADR-0025, permission matrix
-- "Manage administrators and profiles"). A profile names a set of
-- delegable business capabilities; a grant carries either a standard role
-- or one profile, never both. Profiles never carry company administration,
-- so the responsible administrator's approval of administrators cannot be
-- bypassed through a profile.
CREATE TYPE "AccessProfileStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "access_profiles" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "capabilities" TEXT[] NOT NULL,
  "status" "AccessProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "access_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "access_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "access_profiles_name_nonblank" CHECK (btrim("name") <> ''),
  CONSTRAINT "access_profiles_delegable_capabilities" CHECK (
    cardinality("capabilities") >= 1
    AND "capabilities" <@ ARRAY['branches.view', 'invitations.manage', 'audit.view', 'devices.view', 'devices.manage']::TEXT[]
  ),
  CONSTRAINT "access_profiles_version_positive" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "access_profiles_company_id_id_key" ON "access_profiles"("company_id", "id");
-- Active profile names are unique within a company; archived names may be reused.
CREATE UNIQUE INDEX "access_profiles_company_active_name_unique" ON "access_profiles"("company_id", lower("name")) WHERE "status" = 'ACTIVE';

ALTER TABLE "membership_grants"
  ALTER COLUMN "role" DROP NOT NULL,
  ADD COLUMN "profile_id" UUID,
  ADD CONSTRAINT "membership_grants_company_id_profile_id_fkey" FOREIGN KEY ("company_id", "profile_id") REFERENCES "access_profiles"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "membership_grants_role_or_profile" CHECK (num_nonnulls("role", "profile_id") = 1);
CREATE INDEX "membership_grants_profile_idx" ON "membership_grants"("company_id", "profile_id");
