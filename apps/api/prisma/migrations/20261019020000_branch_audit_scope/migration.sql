-- Reviewed branch scope of organization audit events. Branch managers read
-- only the operations of their own branches (permission matrix "View audit"),
-- so each event records the branches it concerns; an event without branches
-- is a company-level operation visible only to company administration.
-- Rows are append-only, like the events they describe.
CREATE TABLE "organization_audit_event_branches" (
  "company_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  CONSTRAINT "organization_audit_event_branches_pkey" PRIMARY KEY ("event_id", "branch_id"),
  CONSTRAINT "organization_audit_event_branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "organization_audit_event_branches_company_id_event_id_fkey" FOREIGN KEY ("company_id", "event_id") REFERENCES "organization_audit_events"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "organization_audit_event_branches_company_id_branch_id_fkey" FOREIGN KEY ("company_id", "branch_id") REFERENCES "branches"("company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "organization_audit_event_branches_branch_idx" ON "organization_audit_event_branches"("company_id", "branch_id");

-- Backfill from immutable sources: branch events name their branch as the
-- target, and grant and invitation branch scopes are never edited.
INSERT INTO "organization_audit_event_branches" ("company_id", "event_id", "branch_id")
SELECT e."company_id", e."id", e."target_id"
FROM "organization_audit_events" e
WHERE e."target_type" = 'branch';

INSERT INTO "organization_audit_event_branches" ("company_id", "event_id", "branch_id")
SELECT e."company_id", e."id", gb."branch_id"
FROM "organization_audit_events" e
JOIN "membership_grant_branches" gb
  ON gb."company_id" = e."company_id" AND gb."grant_id"::text = e."details"->>'grantId'
WHERE e."action" IN ('grant.created', 'grant.revoked');

INSERT INTO "organization_audit_event_branches" ("company_id", "event_id", "branch_id")
SELECT e."company_id", e."id", ib."branch_id"
FROM "organization_audit_events" e
JOIN "company_invitation_branches" ib
  ON ib."company_id" = e."company_id" AND ib."invitation_id"::text = e."details"->>'invitationId'
WHERE e."action" LIKE 'invitation.%';
