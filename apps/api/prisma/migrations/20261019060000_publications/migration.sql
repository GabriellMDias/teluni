-- Reviewed publications (D-04 server side, ADR-0030). A publication is one
-- immutable generation of a program: its manifest is stored as exact bytes
-- with their SHA-256 and a digest of its content, with copies of the
-- playlists it used (and the branch that owned each) and the display
-- renditions of its media, which a reference guard keeps stored until the
-- publication is pruned. Screens report what they received, staged and
-- activated; the latest report per screen and its transitions are kept,
-- the transitions for 30 days. Reported publication IDs are untrusted and
-- carry no references. Profiles may delegate publications.publish.
-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "branch_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "generation" INTEGER NOT NULL,
    "protocol" SMALLINT NOT NULL,
    "content_sha256" BYTEA NOT NULL,
    "manifest" BYTEA,
    "manifest_sha256" BYTEA NOT NULL,
    "manifest_size" INTEGER NOT NULL,
    "rule_count" INTEGER NOT NULL,
    "playlist_count" INTEGER NOT NULL,
    "item_count" INTEGER NOT NULL,
    "media_count" INTEGER NOT NULL,
    "media_bytes" BIGINT NOT NULL,
    "restored_from_generation" INTEGER,
    "published_by_principal_id" UUID NOT NULL,
    "published_by_membership_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(3),
    "pruned_at" TIMESTAMPTZ(3),

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_playlists" (
    "company_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "branch_id" UUID,

    CONSTRAINT "publication_playlists_pkey" PRIMARY KEY ("company_id","publication_id","playlist_id")
);

-- CreateTable
CREATE TABLE "publication_media" (
    "company_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "sha256" BYTEA NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "content_type" VARCHAR(64) NOT NULL,

    CONSTRAINT "publication_media_pkey" PRIMARY KEY ("company_id","publication_id","media_asset_id")
);

-- CreateTable
CREATE TABLE "publication_device_states" (
    "company_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "protocol" SMALLINT NOT NULL,
    "app_version" VARCHAR(64) NOT NULL,
    "desired_publication_id" UUID,
    "active_publication_id" UUID,
    "active_since" TIMESTAMPTZ(3),
    "recovery_publication_id" UUID,
    "staging_publication_id" UUID,
    "staging_state" VARCHAR(16),
    "staging_failure" VARCHAR(32),
    "staging_bytes_done" BIGINT,
    "staging_bytes_total" BIGINT,
    "playback" VARCHAR(32) NOT NULL,
    "storage_free_bytes" BIGINT,
    "storage_total_bytes" BIGINT,
    "device_time" TIMESTAMPTZ(3),

    CONSTRAINT "publication_device_states_pkey" PRIMARY KEY ("company_id","device_id")
);

-- CreateTable
CREATE TABLE "publication_device_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" VARCHAR(32) NOT NULL,
    "publication_id" UUID,
    "detail" VARCHAR(32),

    CONSTRAINT "publication_device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_audit_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subject_type" VARCHAR(16) NOT NULL,
    "subject_id" UUID NOT NULL,
    "branch_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_principal_id" UUID NOT NULL,
    "actor_membership_id" UUID NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "publication_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publications_company_published_idx" ON "publications"("company_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "publications_company_id_id_key" ON "publications"("company_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "publications_generation_key" ON "publications"("company_id", "program_id", "generation");

-- CreateIndex
CREATE INDEX "publication_media_asset_idx" ON "publication_media"("company_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "publication_device_events_device_idx" ON "publication_device_events"("company_id", "device_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "publication_device_events_occurred_idx" ON "publication_device_events"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "publication_device_events_company_id_id_key" ON "publication_device_events"("company_id", "id");

-- CreateIndex
CREATE INDEX "publication_audit_events_subject_idx" ON "publication_audit_events"("company_id", "subject_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "publication_audit_events_company_id_id_key" ON "publication_audit_events"("company_id", "id");

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_company_id_program_id_fkey" FOREIGN KEY ("company_id", "program_id") REFERENCES "programs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_published_by_principal_id_fkey" FOREIGN KEY ("published_by_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_company_id_published_by_membership_id_fkey" FOREIGN KEY ("company_id", "published_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_playlists" ADD CONSTRAINT "publication_playlists_company_id_publication_id_fkey" FOREIGN KEY ("company_id", "publication_id") REFERENCES "publications"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_playlists" ADD CONSTRAINT "publication_playlists_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_company_id_publication_id_fkey" FOREIGN KEY ("company_id", "publication_id") REFERENCES "publications"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_company_id_media_asset_id_fkey" FOREIGN KEY ("company_id", "media_asset_id") REFERENCES "media_assets"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_device_states" ADD CONSTRAINT "publication_device_states_company_id_device_id_fkey" FOREIGN KEY ("company_id", "device_id") REFERENCES "devices"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_device_events" ADD CONSTRAINT "publication_device_events_company_id_device_id_fkey" FOREIGN KEY ("company_id", "device_id") REFERENCES "devices"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_audit_events" ADD CONSTRAINT "publication_audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_audit_events" ADD CONSTRAINT "publication_audit_events_actor_principal_id_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publication_audit_events" ADD CONSTRAINT "publication_audit_events_company_id_actor_membership_id_fkey" FOREIGN KEY ("company_id", "actor_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Value invariants Prisma cannot express.
ALTER TABLE "publications"
  ADD CONSTRAINT "publications_branch_ids_present" CHECK ("branch_ids" IS NOT NULL AND cardinality("branch_ids") <= 100),
  ADD CONSTRAINT "publications_generation_positive" CHECK ("generation" >= 1),
  ADD CONSTRAINT "publications_protocol_known" CHECK ("protocol" = 1),
  ADD CONSTRAINT "publications_digests" CHECK (octet_length("content_sha256") = 32 AND octet_length("manifest_sha256") = 32),
  ADD CONSTRAINT "publications_manifest_until_pruned" CHECK (("manifest" IS NULL) = ("pruned_at" IS NOT NULL)),
  ADD CONSTRAINT "publications_manifest_size" CHECK ("manifest_size" > 0 AND ("manifest" IS NULL OR octet_length("manifest") = "manifest_size")),
  ADD CONSTRAINT "publications_counts" CHECK (
    "rule_count" >= 0 AND "playlist_count" >= 0 AND "item_count" BETWEEN 0 AND 2000
    AND "media_count" BETWEEN 0 AND 1000 AND "media_bytes" >= 0
  ),
  ADD CONSTRAINT "publications_restored_from" CHECK ("restored_from_generation" IS NULL OR "restored_from_generation" BETWEEN 1 AND "generation" - 1),
  ADD CONSTRAINT "publications_pruned_after_superseded" CHECK ("pruned_at" IS NULL OR "superseded_at" IS NOT NULL);

ALTER TABLE "publication_media"
  ADD CONSTRAINT "publication_media_sha256" CHECK (octet_length("sha256") = 32),
  ADD CONSTRAINT "publication_media_size" CHECK ("byte_size" > 0);

ALTER TABLE "publication_device_states"
  ADD CONSTRAINT "publication_device_states_protocol" CHECK ("protocol" >= 1),
  ADD CONSTRAINT "publication_device_states_staging" CHECK (
    ("staging_publication_id" IS NULL AND "staging_state" IS NULL AND "staging_failure" IS NULL
      AND "staging_bytes_done" IS NULL AND "staging_bytes_total" IS NULL)
    OR ("staging_publication_id" IS NOT NULL
      AND "staging_state" IN ('DOWNLOADING', 'VERIFYING', 'READY', 'FAILED')
      AND ("staging_failure" IS NULL) = ("staging_state" <> 'FAILED')
      AND "staging_bytes_done" >= 0 AND "staging_bytes_total" >= 0)
  ),
  ADD CONSTRAINT "publication_device_states_failure" CHECK (
    "staging_failure" IS NULL
    OR "staging_failure" IN ('STORAGE_FULL', 'DOWNLOAD_FAILED', 'INTEGRITY_FAILED', 'INVALID_MANIFEST', 'INCOMPATIBLE')
  ),
  ADD CONSTRAINT "publication_device_states_playback" CHECK (
    "playback" IN ('PLAYING', 'NEUTRAL', 'AUTHORIZATION_EXPIRED', 'CLOCK_UNTRUSTED', 'DEGRADED', 'SETUP')
  ),
  ADD CONSTRAINT "publication_device_states_storage" CHECK (
    ("storage_free_bytes" IS NULL) = ("storage_total_bytes" IS NULL)
    AND ("storage_free_bytes" IS NULL OR "storage_free_bytes" BETWEEN 0 AND "storage_total_bytes")
  );

ALTER TABLE "publication_device_events"
  ADD CONSTRAINT "publication_device_events_kind" CHECK (
    "kind" IN ('DESIRED_DELIVERED', 'ACTIVATED', 'STAGING_FAILED', 'PLAYBACK_CHANGED')
  );

ALTER TABLE "publication_audit_events"
  ADD CONSTRAINT "publication_audit_events_branch_ids_present" CHECK ("branch_ids" IS NOT NULL AND cardinality("branch_ids") <= 100),
  ADD CONSTRAINT "publication_audit_events_subject_type" CHECK ("subject_type" = 'program'),
  ADD CONSTRAINT "publication_audit_events_details_object" CHECK (jsonb_typeof("details") = 'object');

-- Profiles may delegate publications.publish.
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_delegable_capabilities";
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_delegable_capabilities" CHECK (
  cardinality("capabilities") >= 1
  AND "capabilities" <@ ARRAY['branches.view', 'invitations.manage', 'audit.view', 'devices.view', 'devices.manage', 'media.view', 'media.upload', 'media.archive', 'programming.view', 'programming.edit', 'programming.assign', 'publications.publish']::TEXT[]
);
