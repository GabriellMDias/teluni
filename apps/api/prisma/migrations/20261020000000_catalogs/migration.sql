-- Reviewed catalogs (D-11, ADR-0032). A catalog is a typed collection owned
-- by a company or one branch. Its fields keep stable identifiers; a field's
-- type, currency and reference target never change. Records hold their
-- values as validated JSON keyed by field identifier, with money values as
-- integer minor units of the field's currency (the base price). Branch
-- overrides and promotions are rows of their own; promotions carry local
-- wall-clock windows evaluated per screen. Media and record references in
-- values are mirrored in join tables so deletions can be guarded. Profiles
-- may delegate the catalog and price capabilities.
-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
-- CreateEnum
CREATE TYPE "CatalogFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'TIME', 'WEEKDAYS', 'SELECTION', 'MONEY', 'MEDIA', 'REFERENCE');
-- CreateTable
CREATE TABLE "catalogs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "catalog_fields" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "type" "CatalogFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "currency" CHAR(3),
    "target_catalog_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_fields_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "catalog_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "field_values" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_membership_id" UUID NOT NULL,
    "updated_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_records_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "catalog_price_overrides" (
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_price_overrides_pkey" PRIMARY KEY ("company_id","record_id","field_id","branch_id")
);
-- CreateTable
CREATE TABLE "catalog_promotions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "branch_id" UUID,
    "amount" BIGINT NOT NULL,
    "starts_at" TIMESTAMP(0) NOT NULL,
    "ends_at" TIMESTAMP(0) NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "catalog_promotions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "catalog_record_media" (
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    CONSTRAINT "catalog_record_media_pkey" PRIMARY KEY ("company_id","record_id","field_id")
);
-- CreateTable
CREATE TABLE "catalog_record_references" (
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "target_record_id" UUID NOT NULL,
    CONSTRAINT "catalog_record_references_pkey" PRIMARY KEY ("company_id","record_id","field_id")
);
-- CreateTable
CREATE TABLE "catalog_audit_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "record_id" UUID,
    "branch_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_principal_id" UUID NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "catalog_audit_events_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "catalogs_company_created_idx" ON "catalogs"("company_id", "created_at" DESC, "id" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "catalogs_company_id_id_key" ON "catalogs"("company_id", "id");
-- CreateIndex
CREATE INDEX "catalog_fields_catalog_position_idx" ON "catalog_fields"("company_id", "catalog_id", "position");
-- CreateIndex
CREATE INDEX "catalog_fields_target_idx" ON "catalog_fields"("company_id", "target_catalog_id");
-- CreateIndex
CREATE UNIQUE INDEX "catalog_fields_company_id_id_key" ON "catalog_fields"("company_id", "id");
-- CreateIndex
CREATE INDEX "catalog_records_catalog_position_idx" ON "catalog_records"("company_id", "catalog_id", "position", "id");
-- CreateIndex
CREATE UNIQUE INDEX "catalog_records_company_id_id_key" ON "catalog_records"("company_id", "id");
-- CreateIndex
CREATE INDEX "catalog_price_overrides_field_idx" ON "catalog_price_overrides"("company_id", "catalog_id", "field_id");
-- CreateIndex
CREATE INDEX "catalog_price_overrides_branch_idx" ON "catalog_price_overrides"("company_id", "branch_id");
-- CreateIndex
CREATE INDEX "catalog_promotions_price_idx" ON "catalog_promotions"("company_id", "record_id", "field_id", "starts_at");
-- CreateIndex
CREATE INDEX "catalog_promotions_field_idx" ON "catalog_promotions"("company_id", "catalog_id", "field_id");
-- CreateIndex
CREATE UNIQUE INDEX "catalog_promotions_company_id_id_key" ON "catalog_promotions"("company_id", "id");
-- CreateIndex
CREATE INDEX "catalog_record_media_asset_idx" ON "catalog_record_media"("company_id", "media_asset_id");
-- CreateIndex
CREATE INDEX "catalog_record_references_target_idx" ON "catalog_record_references"("company_id", "target_record_id");
-- CreateIndex
CREATE INDEX "catalog_audit_events_catalog_idx" ON "catalog_audit_events"("company_id", "catalog_id", "occurred_at" DESC, "id" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "catalog_audit_events_company_id_id_key" ON "catalog_audit_events"("company_id", "id");
-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_fields" ADD CONSTRAINT "catalog_fields_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_fields" ADD CONSTRAINT "catalog_fields_company_id_target_catalog_id_fkey" FOREIGN KEY ("company_id", "target_catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_company_id_created_by_membership_id_fkey" FOREIGN KEY ("company_id", "created_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_company_id_updated_by_membership_id_fkey" FOREIGN KEY ("company_id", "updated_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_price_overrides" ADD CONSTRAINT "catalog_price_overrides_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_price_overrides" ADD CONSTRAINT "catalog_price_overrides_company_id_record_id_fkey" FOREIGN KEY ("company_id", "record_id") REFERENCES "catalog_records"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_price_overrides" ADD CONSTRAINT "catalog_price_overrides_company_id_field_id_fkey" FOREIGN KEY ("company_id", "field_id") REFERENCES "catalog_fields"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_price_overrides" ADD CONSTRAINT "catalog_price_overrides_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_promotions" ADD CONSTRAINT "catalog_promotions_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_promotions" ADD CONSTRAINT "catalog_promotions_company_id_record_id_fkey" FOREIGN KEY ("company_id", "record_id") REFERENCES "catalog_records"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_promotions" ADD CONSTRAINT "catalog_promotions_company_id_field_id_fkey" FOREIGN KEY ("company_id", "field_id") REFERENCES "catalog_fields"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_promotions" ADD CONSTRAINT "catalog_promotions_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_promotions" ADD CONSTRAINT "catalog_promotions_company_id_created_by_membership_id_fkey" FOREIGN KEY ("company_id", "created_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_media" ADD CONSTRAINT "catalog_record_media_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_media" ADD CONSTRAINT "catalog_record_media_company_id_record_id_fkey" FOREIGN KEY ("company_id", "record_id") REFERENCES "catalog_records"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_media" ADD CONSTRAINT "catalog_record_media_company_id_field_id_fkey" FOREIGN KEY ("company_id", "field_id") REFERENCES "catalog_fields"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_media" ADD CONSTRAINT "catalog_record_media_company_id_media_asset_id_fkey" FOREIGN KEY ("company_id", "media_asset_id") REFERENCES "media_assets"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_references" ADD CONSTRAINT "catalog_record_references_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_references" ADD CONSTRAINT "catalog_record_references_company_id_record_id_fkey" FOREIGN KEY ("company_id", "record_id") REFERENCES "catalog_records"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_references" ADD CONSTRAINT "catalog_record_references_company_id_field_id_fkey" FOREIGN KEY ("company_id", "field_id") REFERENCES "catalog_fields"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_record_references" ADD CONSTRAINT "catalog_record_references_company_id_target_record_id_fkey" FOREIGN KEY ("company_id", "target_record_id") REFERENCES "catalog_records"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_audit_events" ADD CONSTRAINT "catalog_audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_audit_events" ADD CONSTRAINT "catalog_audit_events_actor_principal_id_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "catalog_audit_events" ADD CONSTRAINT "catalog_audit_events_company_id_actor_membership_id_fkey" FOREIGN KEY ("company_id", "actor_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Value invariants Prisma cannot express.
ALTER TABLE "catalogs"
  ADD CONSTRAINT "catalogs_name_trimmed" CHECK ("name" = btrim("name") AND char_length("name") >= 1),
  ADD CONSTRAINT "catalogs_version_positive" CHECK ("version" >= 1 AND "schema_version" >= 1);

ALTER TABLE "catalog_fields"
  ADD CONSTRAINT "catalog_fields_label_trimmed" CHECK ("label" = btrim("label") AND char_length("label") >= 1),
  ADD CONSTRAINT "catalog_fields_position_range" CHECK ("position" BETWEEN 0 AND 59),
  ADD CONSTRAINT "catalog_fields_settings_object" CHECK (jsonb_typeof("settings") = 'object'),
  ADD CONSTRAINT "catalog_fields_currency" CHECK (
    ("type" = 'MONEY') = ("currency" IS NOT NULL)
    AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
  ),
  ADD CONSTRAINT "catalog_fields_target" CHECK (("type" = 'REFERENCE') = ("target_catalog_id" IS NOT NULL)),
  ADD CONSTRAINT "catalog_fields_money_optional" CHECK (NOT ("type" = 'MONEY' AND "required"));

ALTER TABLE "catalog_records"
  ADD CONSTRAINT "catalog_records_position_range" CHECK ("position" >= 0),
  ADD CONSTRAINT "catalog_records_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "catalog_records_values_object" CHECK (
    jsonb_typeof("field_values") = 'object' AND octet_length("field_values"::text) <= 32768
  );

ALTER TABLE "catalog_price_overrides"
  ADD CONSTRAINT "catalog_price_overrides_amount_range" CHECK ("amount" BETWEEN 0 AND 1000000000000);

ALTER TABLE "catalog_promotions"
  ADD CONSTRAINT "catalog_promotions_amount_range" CHECK ("amount" BETWEEN 0 AND 1000000000000),
  ADD CONSTRAINT "catalog_promotions_window" CHECK (
    "ends_at" > "starts_at"
    AND date_trunc('minute', "starts_at") = "starts_at"
    AND date_trunc('minute', "ends_at") = "ends_at"
  );

ALTER TABLE "catalog_audit_events"
  ADD CONSTRAINT "catalog_audit_events_branch_ids_present" CHECK ("branch_ids" IS NOT NULL AND cardinality("branch_ids") <= 100),
  ADD CONSTRAINT "catalog_audit_events_details_object" CHECK (jsonb_typeof("details") = 'object');

-- Profiles may delegate the catalog and price capabilities.
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_delegable_capabilities";
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_delegable_capabilities" CHECK (
  cardinality("capabilities") >= 1
  AND "capabilities" <@ ARRAY['branches.view', 'invitations.manage', 'audit.view', 'devices.view', 'devices.manage', 'media.view', 'media.upload', 'media.archive', 'programming.view', 'programming.edit', 'programming.assign', 'publications.publish', 'catalogs.view', 'catalogs.edit', 'catalogs.manage', 'prices.edit']::TEXT[]
);
