-- Reviewed layouts (D-11 increment 2). A layout is a reusable canvas owned
-- by a company or one branch, with up to 12 freeform areas. Media areas
-- play what their program output selects; catalog areas show a catalog
-- view that binds catalog fields by role. Optional pages coordinate the
-- page-controlled areas. Areas, view fields, pages and page contents are
-- replaced as a whole on every save; an area's key stays stable so program
-- outputs can refer to it. Catalog, field and media references block their
-- deletion. Programming audit events gain the layout subject.
-- CreateEnum
CREATE TYPE "LayoutOrientation" AS ENUM ('LANDSCAPE', 'PORTRAIT');
-- CreateEnum
CREATE TYPE "LayoutAreaKind" AS ENUM ('MEDIA', 'CATALOG');
-- CreateTable
CREATE TABLE "layouts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "orientation" "LayoutOrientation" NOT NULL,
    "audio_mix_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "layouts_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "layout_areas" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "key" VARCHAR(16) NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "z" INTEGER NOT NULL,
    "background" CHAR(7) NOT NULL,
    "fit" VARCHAR(8) NOT NULL,
    "muted" BOOLEAN NOT NULL,
    "volume" INTEGER NOT NULL,
    "kind" "LayoutAreaKind" NOT NULL,
    "page_controlled" BOOLEAN NOT NULL,
    "catalog_id" UUID,
    "presentation" VARCHAR(8),
    "text_size" INTEGER,
    "show_unavailable" BOOLEAN,
    "page_seconds" INTEGER,
    CONSTRAINT "layout_areas_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "layout_view_fields" (
    "company_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "field_id" UUID NOT NULL,
    "role" VARCHAR(8) NOT NULL,
    CONSTRAINT "layout_view_fields_pkey" PRIMARY KEY ("company_id","area_id","position")
);
-- CreateTable
CREATE TABLE "layout_pages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    CONSTRAINT "layout_pages_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "layout_page_contents" (
    "company_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,
    "media_asset_id" UUID,
    "view_page" INTEGER,
    "group_choice_id" VARCHAR(64),
    CONSTRAINT "layout_page_contents_pkey" PRIMARY KEY ("company_id","page_id","area_id")
);
-- CreateIndex
CREATE INDEX "layouts_company_created_idx" ON "layouts"("company_id", "created_at" DESC, "id" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "layouts_company_id_id_key" ON "layouts"("company_id", "id");
-- CreateIndex
CREATE INDEX "layout_areas_catalog_idx" ON "layout_areas"("company_id", "catalog_id");
-- CreateIndex
CREATE UNIQUE INDEX "layout_areas_company_id_id_key" ON "layout_areas"("company_id", "id");
-- CreateIndex
CREATE UNIQUE INDEX "layout_areas_key_key" ON "layout_areas"("company_id", "layout_id", "key");
-- CreateIndex
CREATE INDEX "layout_view_fields_field_idx" ON "layout_view_fields"("company_id", "field_id");
-- CreateIndex
CREATE UNIQUE INDEX "layout_pages_company_id_id_key" ON "layout_pages"("company_id", "id");
-- CreateIndex
CREATE UNIQUE INDEX "layout_pages_position_key" ON "layout_pages"("company_id", "layout_id", "position");
-- CreateIndex
CREATE INDEX "layout_page_contents_area_idx" ON "layout_page_contents"("company_id", "area_id");
-- CreateIndex
CREATE INDEX "layout_page_contents_media_idx" ON "layout_page_contents"("company_id", "media_asset_id");
-- AddForeignKey
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_areas" ADD CONSTRAINT "layout_areas_company_id_layout_id_fkey" FOREIGN KEY ("company_id", "layout_id") REFERENCES "layouts"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_areas" ADD CONSTRAINT "layout_areas_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_view_fields" ADD CONSTRAINT "layout_view_fields_company_id_area_id_fkey" FOREIGN KEY ("company_id", "area_id") REFERENCES "layout_areas"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_view_fields" ADD CONSTRAINT "layout_view_fields_company_id_field_id_fkey" FOREIGN KEY ("company_id", "field_id") REFERENCES "catalog_fields"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_pages" ADD CONSTRAINT "layout_pages_company_id_layout_id_fkey" FOREIGN KEY ("company_id", "layout_id") REFERENCES "layouts"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_page_contents" ADD CONSTRAINT "layout_page_contents_company_id_page_id_fkey" FOREIGN KEY ("company_id", "page_id") REFERENCES "layout_pages"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_page_contents" ADD CONSTRAINT "layout_page_contents_company_id_area_id_fkey" FOREIGN KEY ("company_id", "area_id") REFERENCES "layout_areas"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
-- AddForeignKey
ALTER TABLE "layout_page_contents" ADD CONSTRAINT "layout_page_contents_company_id_media_asset_id_fkey" FOREIGN KEY ("company_id", "media_asset_id") REFERENCES "media_assets"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Value invariants Prisma cannot express. Bounds that depend on the canvas
-- (orientation) are checked by the API.
ALTER TABLE "layouts"
  ADD CONSTRAINT "layouts_name_trimmed" CHECK ("name" = btrim("name") AND char_length("name") >= 1),
  ADD CONSTRAINT "layouts_version_positive" CHECK ("version" >= 1);

ALTER TABLE "layout_areas"
  ADD CONSTRAINT "layout_areas_key_shape" CHECK ("key" ~ '^[a-z][a-z0-9-]{0,15}$'),
  ADD CONSTRAINT "layout_areas_name_trimmed" CHECK ("name" = btrim("name") AND char_length("name") >= 1),
  ADD CONSTRAINT "layout_areas_geometry" CHECK (
    "x" >= 0 AND "y" >= 0 AND "width" >= 40 AND "height" >= 40
    AND "x" + "width" <= 1920 AND "y" + "height" <= 1920
  ),
  ADD CONSTRAINT "layout_areas_stack_range" CHECK ("z" BETWEEN 0 AND 99),
  ADD CONSTRAINT "layout_areas_background" CHECK ("background" ~ '^#[0-9A-F]{6}$'),
  ADD CONSTRAINT "layout_areas_fit" CHECK ("fit" IN ('contain', 'cover')),
  ADD CONSTRAINT "layout_areas_volume_range" CHECK ("volume" BETWEEN 0 AND 100),
  ADD CONSTRAINT "layout_areas_view" CHECK (
    ("kind" = 'CATALOG') = ("catalog_id" IS NOT NULL)
    AND ("kind" = 'CATALOG') = ("presentation" IS NOT NULL)
    AND ("kind" = 'CATALOG') = ("text_size" IS NOT NULL)
    AND ("kind" = 'CATALOG') = ("show_unavailable" IS NOT NULL)
    AND ("kind" = 'CATALOG') = ("page_seconds" IS NOT NULL)
    AND ("presentation" IS NULL OR "presentation" IN ('list', 'table', 'menu', 'agenda'))
    AND ("text_size" IS NULL OR "text_size" BETWEEN 24 AND 200)
    AND ("page_seconds" IS NULL OR "page_seconds" BETWEEN 5 AND 120)
  );

ALTER TABLE "layout_view_fields"
  ADD CONSTRAINT "layout_view_fields_position_range" CHECK ("position" BETWEEN 0 AND 7),
  ADD CONSTRAINT "layout_view_fields_role" CHECK ("role" IN ('title', 'subtitle', 'price', 'image', 'detail', 'group'));

ALTER TABLE "layout_pages"
  ADD CONSTRAINT "layout_pages_position_range" CHECK ("position" BETWEEN 0 AND 19),
  ADD CONSTRAINT "layout_pages_duration_range" CHECK ("duration_seconds" BETWEEN 1 AND 600);

ALTER TABLE "layout_page_contents"
  ADD CONSTRAINT "layout_page_contents_one_choice" CHECK (
    num_nonnulls("media_asset_id", "view_page", "group_choice_id") = 1
    AND ("view_page" IS NULL OR "view_page" BETWEEN 1 AND 1000)
  );

-- Layout changes use the programming audit.
ALTER TABLE "programming_audit_events" DROP CONSTRAINT "programming_audit_events_subject_type";
ALTER TABLE "programming_audit_events"
  ADD CONSTRAINT "programming_audit_events_subject_type" CHECK ("subject_type" IN ('playlist', 'group', 'program', 'device', 'layout'));
