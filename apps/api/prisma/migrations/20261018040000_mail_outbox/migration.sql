-- Reviewed transactional outbound-email outbox (ADR-0026, D-13). A producer
-- inserts a message in the same transaction as the change it reports; the
-- API's dispatcher claims due messages with SKIP LOCKED leases and records
-- the outcome. Secret parameters stay sealed only while a message is pending.
CREATE TYPE "OutboundEmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

CREATE TABLE "outbound_emails" (
  "id" UUID NOT NULL,
  "producer" VARCHAR(64) NOT NULL,
  "producer_reference" UUID NOT NULL,
  "template" VARCHAR(64) NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "recipient" VARCHAR(254) NOT NULL,
  "parameters" JSONB NOT NULL,
  "sealed_secret" BYTEA,
  "status" "OutboundEmailStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_expires_at" TIMESTAMPTZ(3),
  "last_failure" VARCHAR(32),
  "last_reply_code" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalized_at" TIMESTAMPTZ(3),
  CONSTRAINT "outbound_emails_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_emails_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "outbound_emails_final_state" CHECK (("status" = 'PENDING') = ("finalized_at" IS NULL)),
  CONSTRAINT "outbound_emails_secret_only_pending" CHECK ("status" = 'PENDING' OR "sealed_secret" IS NULL),
  CONSTRAINT "outbound_emails_parameters_object" CHECK (jsonb_typeof("parameters") = 'object')
);
CREATE INDEX "outbound_emails_producer_idx" ON "outbound_emails"("producer", "producer_reference");
-- Due pending messages, in claiming order.
CREATE INDEX "outbound_emails_due_idx" ON "outbound_emails"("next_attempt_at") WHERE "status" = 'PENDING';
-- Final messages, in retention-cleanup order.
CREATE INDEX "outbound_emails_finalized_idx" ON "outbound_emails"("finalized_at") WHERE "status" <> 'PENDING';
