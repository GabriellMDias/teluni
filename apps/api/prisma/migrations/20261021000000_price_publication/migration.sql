-- Automatic price publication (catalog and composition design, increment
-- 4): a price change counts itself per catalog in commit order, finds the
-- programs whose latest publication copies the catalog, and commits one
-- durable intent per program; the API's processor turns each intent into a
-- new generation that changes only that catalog's prices.

-- Where a publication came from: a person's publication, a restore, or the
-- price processor.
ALTER TABLE "publications" ADD COLUMN "origin" VARCHAR(16) NOT NULL DEFAULT 'MANUAL';
UPDATE "publications" SET "origin" = 'RESTORE' WHERE "restored_from_generation" IS NOT NULL;
ALTER TABLE "publications"
  ADD CONSTRAINT "publications_origin_known" CHECK ("origin" IN ('MANUAL', 'RESTORE', 'PRICE')),
  ADD CONSTRAINT "publications_origin_restore" CHECK (("origin" = 'RESTORE') = ("restored_from_generation" IS NOT NULL));

-- The price change counter of each catalog; a row appears with the first change.
CREATE TABLE "catalog_price_sequences" (
    "company_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "catalog_price_sequences_pkey" PRIMARY KEY ("company_id","catalog_id"),
    CONSTRAINT "catalog_price_sequences_nonnegative" CHECK ("sequence" >= 0)
);

-- The catalogs each protocol 2 publication copies, with the price sequence
-- its copy includes.
CREATE TABLE "publication_catalogs" (
    "company_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "price_sequence" BIGINT NOT NULL,

    CONSTRAINT "publication_catalogs_pkey" PRIMARY KEY ("company_id","publication_id","catalog_id"),
    CONSTRAINT "publication_catalogs_sequence_nonnegative" CHECK ("price_sequence" >= 0)
);

CREATE TABLE "price_publication_intents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "price_sequence" BIGINT NOT NULL,
    "author_membership_id" UUID NOT NULL,
    "authorized_by_membership_id" UUID,
    "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(32),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMPTZ(3),
    "publication_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_publication_intents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_publication_intents_state_known" CHECK ("state" IN ('PENDING', 'PUBLISHED', 'SKIPPED', 'BLOCKED', 'FAILED')),
    CONSTRAINT "price_publication_intents_sequence_positive" CHECK ("price_sequence" >= 1),
    CONSTRAINT "price_publication_intents_attempts_nonnegative" CHECK ("attempts" >= 0),
    CONSTRAINT "price_publication_intents_lease_pending" CHECK ("state" = 'PENDING' OR "lease_expires_at" IS NULL),
    CONSTRAINT "price_publication_intents_publication_outcome" CHECK ("publication_id" IS NULL OR "state" IN ('PUBLISHED', 'SKIPPED'))
);

CREATE INDEX "publication_catalogs_catalog_idx" ON "publication_catalogs"("company_id", "catalog_id");
CREATE INDEX "price_publication_intents_catalog_idx" ON "price_publication_intents"("company_id", "catalog_id", "created_at" DESC);
CREATE INDEX "price_publication_intents_program_idx" ON "price_publication_intents"("company_id", "program_id");
CREATE UNIQUE INDEX "price_publication_intents_company_id_id_key" ON "price_publication_intents"("company_id", "id");
-- One pending intent per program and catalog: later changes coalesce into it.
CREATE UNIQUE INDEX "price_publication_intents_one_pending" ON "price_publication_intents"("company_id", "program_id", "catalog_id") WHERE "state" = 'PENDING';
-- Due pending intents, in claiming order.
CREATE INDEX "price_publication_intents_due_idx" ON "price_publication_intents"("next_attempt_at") WHERE "state" = 'PENDING';
-- Finished intents, in retention-cleanup order.
CREATE INDEX "price_publication_intents_finished_idx" ON "price_publication_intents"("updated_at") WHERE "state" <> 'PENDING';

ALTER TABLE "catalog_price_sequences" ADD CONSTRAINT "catalog_price_sequences_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "publication_catalogs" ADD CONSTRAINT "publication_catalogs_company_id_publication_id_fkey" FOREIGN KEY ("company_id", "publication_id") REFERENCES "publications"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "publication_catalogs" ADD CONSTRAINT "publication_catalogs_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "price_publication_intents" ADD CONSTRAINT "price_publication_intents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "price_publication_intents" ADD CONSTRAINT "price_publication_intents_company_id_program_id_fkey" FOREIGN KEY ("company_id", "program_id") REFERENCES "programs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "price_publication_intents" ADD CONSTRAINT "price_publication_intents_company_id_catalog_id_fkey" FOREIGN KEY ("company_id", "catalog_id") REFERENCES "catalogs"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "price_publication_intents" ADD CONSTRAINT "price_publication_intents_company_id_author_membership_id_fkey" FOREIGN KEY ("company_id", "author_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "price_publication_intents" ADD CONSTRAINT "price_publication_intents_company_id_authorized_by_members_fkey" FOREIGN KEY ("company_id", "authorized_by_membership_id") REFERENCES "memberships"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "price_publication_intents" ADD CONSTRAINT "price_publication_intents_company_id_publication_id_fkey" FOREIGN KEY ("company_id", "publication_id") REFERENCES "publications"("company_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Existing protocol 2 publications copied their catalogs before any price
-- change was counted, so their copies include sequence 0.
INSERT INTO "publication_catalogs" ("company_id", "publication_id", "catalog_id", "price_sequence")
SELECT p."company_id", p."id", (entry ->> 'id')::uuid, 0
FROM "publications" p
CROSS JOIN LATERAL jsonb_array_elements(convert_from(p."manifest", 'UTF8')::jsonb -> 'catalogs') AS entry
WHERE p."protocol" = 2 AND p."manifest" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "catalogs" c
    WHERE c."company_id" = p."company_id" AND c."id" = (entry ->> 'id')::uuid);
