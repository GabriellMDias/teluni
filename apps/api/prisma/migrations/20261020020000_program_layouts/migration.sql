-- Programs with layouts (catalog and composition design, increment 2):
-- a program may choose one layout of the company, and each of the
-- layout's areas becomes an output keyed by the area's stable key.

-- AlterTable
ALTER TABLE "programs" ADD COLUMN     "layout_id" UUID;

-- CreateIndex
CREATE INDEX "programs_layout_idx" ON "programs"("company_id", "layout_id");

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_company_id_layout_id_fkey" FOREIGN KEY ("company_id", "layout_id") REFERENCES "layouts"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Output keys are `screen` without a layout, or an area key with one; both
-- share the area key shape.
ALTER TABLE "program_outputs" DROP CONSTRAINT "program_outputs_known_key";
ALTER TABLE "program_outputs"
  ADD CONSTRAINT "program_outputs_key_shape" CHECK ("output_key" ~ '^[a-z][a-z0-9-]{0,15}$');

ALTER TABLE "schedule_rules" DROP CONSTRAINT "schedule_rules_known_key";
ALTER TABLE "schedule_rules"
  ADD CONSTRAINT "schedule_rules_key_shape" CHECK ("output_key" ~ '^[a-z][a-z0-9-]{0,15}$');
