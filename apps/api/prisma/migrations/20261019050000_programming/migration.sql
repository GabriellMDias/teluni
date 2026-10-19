-- Reviewed programming (D-06, ADR-0029). Playlists are ordered, looping
-- lists of media owned by a company or one branch. Programming groups
-- cover the whole company or a fixed set of branches. A program holds the
-- draft programming of one group or one screen: per output (the full screen
-- now) an optional default playlist and schedule rules in local values
-- (weekday mask, start and end minute, dates); zones are applied per screen
-- when evaluating. programming_device_settings records each screen's group
-- and individual-programming choice. Screens gain an optional explicit time
-- zone, and profiles may delegate the programming capabilities.
-- CreateEnum
CREATE TYPE "PlaylistTransition" AS ENUM ('CUT', 'FADE');
-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "time_zone" VARCHAR(64);
-- CreateTable
CREATE TABLE "playlists" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "transition" "PlaylistTransition" NOT NULL DEFAULT 'CUT',
    "fade_ms" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "playlist_items" (
    "company_id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "duration_ms" INTEGER,
    CONSTRAINT "playlist_items_pkey" PRIMARY KEY ("company_id","playlist_id","position")
);
-- CreateTable
CREATE TABLE "programming_groups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "all_branches" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "programming_groups_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "programming_group_branches" (
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    CONSTRAINT "programming_group_branches_pkey" PRIMARY KEY ("company_id","group_id","branch_id")
);
-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID,
    "device_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "program_outputs" (
    "company_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "output_key" VARCHAR(32) NOT NULL,
    "default_playlist_id" UUID,
    CONSTRAINT "program_outputs_pkey" PRIMARY KEY ("company_id","program_id","output_key")
);
-- CreateTable
CREATE TABLE "schedule_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "output_key" VARCHAR(32) NOT NULL,
    "position" INTEGER NOT NULL,
    "playlist_id" UUID NOT NULL,
    "weekdays" INTEGER NOT NULL,
    "all_day" BOOLEAN NOT NULL,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    CONSTRAINT "schedule_rules_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "programming_device_settings" (
    "company_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "group_id" UUID,
    "individual" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "programming_device_settings_pkey" PRIMARY KEY ("company_id","device_id")
);
-- CreateTable
CREATE TABLE "programming_audit_events" (
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
    CONSTRAINT "programming_audit_events_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "playlists_company_created_idx" ON "playlists"("company_id", "created_at" DESC, "id" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "playlists_company_id_id_key" ON "playlists"("company_id", "id");
-- CreateIndex
CREATE INDEX "playlist_items_media_idx" ON "playlist_items"("company_id", "media_asset_id");
-- CreateIndex
CREATE UNIQUE INDEX "programming_groups_company_id_id_key" ON "programming_groups"("company_id", "id");
-- CreateIndex
CREATE INDEX "programming_group_branches_branch_idx" ON "programming_group_branches"("company_id", "branch_id");
-- CreateIndex
CREATE UNIQUE INDEX "programs_company_id_id_key" ON "programs"("company_id", "id");
-- CreateIndex
CREATE UNIQUE INDEX "programs_group_key" ON "programs"("company_id", "group_id");
-- CreateIndex
CREATE UNIQUE INDEX "programs_device_key" ON "programs"("company_id", "device_id");
-- CreateIndex
CREATE INDEX "program_outputs_default_idx" ON "program_outputs"("company_id", "default_playlist_id");
-- CreateIndex
CREATE UNIQUE INDEX "schedule_rules_company_id_id_key" ON "schedule_rules"("company_id", "id");
-- CreateIndex
CREATE INDEX "schedule_rules_playlist_idx" ON "schedule_rules"("company_id", "playlist_id");
-- CreateIndex
CREATE UNIQUE INDEX "schedule_rules_position_key" ON "schedule_rules"("company_id", "program_id", "output_key", "position");
-- CreateIndex
CREATE INDEX "programming_device_settings_group_idx" ON "programming_device_settings"("company_id", "group_id");
-- CreateIndex
CREATE INDEX "programming_audit_events_subject_idx" ON "programming_audit_events"("company_id", "subject_id", "occurred_at" DESC, "id" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "programming_audit_events_company_id_id_key" ON "programming_audit_events"("company_id", "id");
-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_company_id_playlist_id_fkey" FOREIGN KEY ("company_id", "playlist_id") REFERENCES "playlists"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_company_id_media_asset_id_fkey" FOREIGN KEY ("company_id", "media_asset_id") REFERENCES "media_assets"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_groups" ADD CONSTRAINT "programming_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_group_branches" ADD CONSTRAINT "programming_group_branches_company_id_group_id_fkey" FOREIGN KEY ("company_id", "group_id") REFERENCES "programming_groups"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_group_branches" ADD CONSTRAINT "programming_group_branches_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_company_id_group_id_fkey" FOREIGN KEY ("company_id", "group_id") REFERENCES "programming_groups"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_company_id_device_id_fkey" FOREIGN KEY ("company_id", "device_id") REFERENCES "devices"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "program_outputs" ADD CONSTRAINT "program_outputs_company_id_program_id_fkey" FOREIGN KEY ("company_id", "program_id") REFERENCES "programs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "program_outputs" ADD CONSTRAINT "program_outputs_company_id_default_playlist_id_fkey" FOREIGN KEY ("company_id", "default_playlist_id") REFERENCES "playlists"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_company_id_program_id_fkey" FOREIGN KEY ("company_id", "program_id") REFERENCES "programs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_company_id_playlist_id_fkey" FOREIGN KEY ("company_id", "playlist_id") REFERENCES "playlists"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_device_settings" ADD CONSTRAINT "programming_device_settings_company_id_device_id_fkey" FOREIGN KEY ("company_id", "device_id") REFERENCES "devices"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_device_settings" ADD CONSTRAINT "programming_device_settings_company_id_group_id_fkey" FOREIGN KEY ("company_id", "group_id") REFERENCES "programming_groups"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_audit_events" ADD CONSTRAINT "programming_audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_audit_events" ADD CONSTRAINT "programming_audit_events_actor_principal_id_fkey" FOREIGN KEY ("actor_principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "programming_audit_events" ADD CONSTRAINT "programming_audit_events_company_id_actor_membership_id_fkey" FOREIGN KEY ("company_id", "actor_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Group names are unique per company ignoring case.
CREATE UNIQUE INDEX "programming_groups_company_name_unique" ON "programming_groups"("company_id", lower("name"));

-- Value invariants Prisma cannot express.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_time_zone_shape" CHECK ("time_zone" IS NULL OR "time_zone" ~ '^[A-Za-z][A-Za-z0-9_+/-]*$');

ALTER TABLE "playlists"
  ADD CONSTRAINT "playlists_name_trimmed" CHECK ("name" = btrim("name") AND char_length("name") >= 1),
  ADD CONSTRAINT "playlists_fade" CHECK (
    ("transition" = 'CUT' AND "fade_ms" IS NULL)
    OR ("transition" = 'FADE' AND "fade_ms" BETWEEN 250 AND 2000)
  ),
  ADD CONSTRAINT "playlists_version_positive" CHECK ("version" >= 1);

ALTER TABLE "playlist_items"
  ADD CONSTRAINT "playlist_items_position_range" CHECK ("position" BETWEEN 0 AND 499),
  ADD CONSTRAINT "playlist_items_duration_range" CHECK ("duration_ms" IS NULL OR "duration_ms" BETWEEN 1000 AND 3600000);

ALTER TABLE "programming_groups"
  ADD CONSTRAINT "programming_groups_name_trimmed" CHECK ("name" = btrim("name") AND char_length("name") >= 1),
  ADD CONSTRAINT "programming_groups_version_positive" CHECK ("version" >= 1);

ALTER TABLE "programs"
  ADD CONSTRAINT "programs_one_source" CHECK (("group_id" IS NULL) <> ("device_id" IS NULL)),
  ADD CONSTRAINT "programs_version_positive" CHECK ("version" >= 1);

ALTER TABLE "program_outputs"
  ADD CONSTRAINT "program_outputs_known_key" CHECK ("output_key" = 'screen');

ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_known_key" CHECK ("output_key" = 'screen'),
  ADD CONSTRAINT "schedule_rules_position_range" CHECK ("position" BETWEEN 0 AND 199),
  ADD CONSTRAINT "schedule_rules_weekdays_mask" CHECK ("weekdays" BETWEEN 1 AND 127),
  ADD CONSTRAINT "schedule_rules_times" CHECK (
    ("all_day" AND "start_minute" IS NULL AND "end_minute" IS NULL)
    OR (NOT "all_day" AND "start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 0 AND 1439
      AND "start_minute" <> "end_minute")
  ),
  ADD CONSTRAINT "schedule_rules_dates" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");

ALTER TABLE "programming_device_settings"
  ADD CONSTRAINT "programming_device_settings_version_positive" CHECK ("version" >= 1);

ALTER TABLE "programming_audit_events"
  ADD CONSTRAINT "programming_audit_events_branch_ids_present" CHECK ("branch_ids" IS NOT NULL AND cardinality("branch_ids") <= 100),
  ADD CONSTRAINT "programming_audit_events_subject_type" CHECK ("subject_type" IN ('playlist', 'group', 'program', 'device')),
  ADD CONSTRAINT "programming_audit_events_details_object" CHECK (jsonb_typeof("details") = 'object');

-- Profiles may delegate the programming capabilities.
ALTER TABLE "access_profiles" DROP CONSTRAINT "access_profiles_delegable_capabilities";
ALTER TABLE "access_profiles" ADD CONSTRAINT "access_profiles_delegable_capabilities" CHECK (
  cardinality("capabilities") >= 1
  AND "capabilities" <@ ARRAY['branches.view', 'invitations.manage', 'audit.view', 'devices.view', 'devices.manage', 'media.view', 'media.upload', 'media.archive', 'programming.view', 'programming.edit', 'programming.assign']::TEXT[]
);
