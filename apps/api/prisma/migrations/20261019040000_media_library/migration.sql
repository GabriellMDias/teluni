-- Reviewed media library (D-05, ADR-0028). An asset belongs to one company
-- and optionally one branch. Its original, display rendition and thumbnail
-- are immutable objects on the media volume named by the SHA-256 of their
-- bytes within the company; media_objects rows record them and serve as the
-- lock that keeps publication and purge consistent. Assets move from
-- UPLOADING through PROCESSING to READY (or REJECTED/FAILED), may be
-- ARCHIVED, DELETED into a 30-day trash and finally PURGED, keeping the row
-- for audit. Profiles may now delegate the media capabilities other than
-- permanent deletion.
-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');

CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'REJECTED', 'FAILED', 'ARCHIVED', 'DELETED', 'PURGED');
-- CreateTable
CREATE TABLE "media_objects" (
    "company_id" UUID NOT NULL,
    "sha256" BYTEA NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "content_type" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_objects_pkey" PRIMARY KEY ("company_id","sha256")
);
-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" "MediaKind" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
    "rejection_reason" VARCHAR(40),
    "declared_content_type" VARCHAR(64) NOT NULL,
    "declared_size" BIGINT NOT NULL,
    "original_sha256" BYTEA,
    "display_sha256" BYTEA,
    "thumbnail_sha256" BYTEA,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "has_audio" BOOLEAN,
    "processing_stage" VARCHAR(16),
    "processing_progress" INTEGER,
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "created_by_membership_id" UUID NOT NULL,
    "created_by_principal_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "purge_after" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "media_audit_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_principal_id" UUID,
    "actor_membership_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "media_audit_events_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "media_assets_company_created_idx" ON "media_assets"("company_id", "created_at" DESC, "id" DESC);
-- CreateIndex
CREATE INDEX "media_assets_company_status_idx" ON "media_assets"("company_id", "status");
-- CreateIndex
CREATE INDEX "media_assets_processing_idx" ON "media_assets"("status", "next_attempt_at");
-- CreateIndex
CREATE INDEX "media_assets_original_idx" ON "media_assets"("company_id", "original_sha256");
-- CreateIndex
CREATE INDEX "media_assets_display_idx" ON "media_assets"("company_id", "display_sha256");
-- CreateIndex
CREATE INDEX "media_assets_thumbnail_idx" ON "media_assets"("company_id", "thumbnail_sha256");
-- CreateIndex
CREATE UNIQUE INDEX "media_assets_company_id_id_key" ON "media_assets"("company_id", "id");
-- CreateIndex
CREATE INDEX "media_audit_events_asset_time_idx" ON "media_audit_events"("company_id", "asset_id", "occurred_at" DESC, "id" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "media_audit_events_company_id_id_key" ON "media_audit_events"("company_id", "id");
-- AddForeignKey
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_created_by_membership_id_fkey" FOREIGN KEY ("company_id", "created_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_principal_id_fkey" FOREIGN KEY ("created_by_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_original_sha256_fkey" FOREIGN KEY ("company_id", "original_sha256") REFERENCES "media_objects"("company_id", "sha256") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_display_sha256_fkey" FOREIGN KEY ("company_id", "display_sha256") REFERENCES "media_objects"("company_id", "sha256") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_thumbnail_sha256_fkey" FOREIGN KEY ("company_id", "thumbnail_sha256") REFERENCES "media_objects"("company_id", "sha256") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_audit_events" ADD CONSTRAINT "media_audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_audit_events" ADD CONSTRAINT "media_audit_events_company_id_asset_id_fkey" FOREIGN KEY ("company_id", "asset_id") REFERENCES "media_assets"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_audit_events" ADD CONSTRAINT "media_audit_events_actor_principal_id_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "media_audit_events" ADD CONSTRAINT "media_audit_events_company_id_actor_membership_id_fkey" FOREIGN KEY ("company_id", "actor_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Lifecycle and value invariants Prisma cannot express.
ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_sha256_length" CHECK (octet_length("sha256") = 32),
  ADD CONSTRAINT "media_objects_size_positive" CHECK ("byte_size" > 0);

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_name_trimmed" CHECK ("name" = btrim("name") AND char_length("name") >= 1),
  ADD CONSTRAINT "media_assets_tags_bounded" CHECK ("tags" IS NOT NULL AND cardinality("tags") <= 10),
  ADD CONSTRAINT "media_assets_declared_size_positive" CHECK ("declared_size" > 0),
  ADD CONSTRAINT "media_assets_hash_lengths" CHECK (
    ("original_sha256" IS NULL OR octet_length("original_sha256") = 32)
    AND ("display_sha256" IS NULL OR octet_length("display_sha256") = 32)
    AND ("thumbnail_sha256" IS NULL OR octet_length("thumbnail_sha256") = 32)
  ),
  ADD CONSTRAINT "media_assets_usable_objects" CHECK (
    "status" NOT IN ('READY', 'ARCHIVED', 'DELETED')
    OR ("original_sha256" IS NOT NULL AND "display_sha256" IS NOT NULL AND "thumbnail_sha256" IS NOT NULL
      AND "width" IS NOT NULL AND "height" IS NOT NULL AND "ready_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "media_assets_unusable_without_renditions" CHECK (
    "status" NOT IN ('UPLOADING', 'REJECTED', 'FAILED', 'PURGED')
    OR ("display_sha256" IS NULL AND "thumbnail_sha256" IS NULL)
  ),
  ADD CONSTRAINT "media_assets_rejection_state" CHECK (("status" = 'REJECTED') = ("rejection_reason" IS NOT NULL)),
  ADD CONSTRAINT "media_assets_trash_state" CHECK (("status" = 'DELETED') = ("purge_after" IS NOT NULL)),
  ADD CONSTRAINT "media_assets_purged_state" CHECK (("status" = 'PURGED') = ("purged_at" IS NOT NULL)),
  ADD CONSTRAINT "media_assets_video_duration" CHECK ("duration_ms" IS NULL OR ("kind" = 'VIDEO' AND "duration_ms" > 0)),
  ADD CONSTRAINT "media_assets_dimensions_positive" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)),
  ADD CONSTRAINT "media_assets_progress_range" CHECK ("processing_progress" IS NULL OR "processing_progress" BETWEEN 0 AND 100),
  ADD CONSTRAINT "media_assets_attempts_nonnegative" CHECK ("processing_attempts" >= 0),
  ADD CONSTRAINT "media_assets_version_positive" CHECK ("version" >= 1);

ALTER TABLE "media_audit_events"
  ADD CONSTRAINT "media_audit_events_details_object" CHECK (jsonb_typeof("details") = 'object');

-- Profiles may delegate viewing, uploading and archiving media; permanent
-- deletion stays with company administrators.
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_delegable_capabilities";
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_delegable_capabilities" CHECK (
  cardinality("capabilities") >= 1
  AND "capabilities" <@ ARRAY['branches.view', 'invitations.manage', 'audit.view', 'devices.view', 'devices.manage', 'media.view', 'media.upload', 'media.archive']::TEXT[]
);
