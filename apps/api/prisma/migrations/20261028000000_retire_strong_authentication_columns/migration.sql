-- Contract stage of optional two-step verification (2026-10-28). The API since
-- commit 5760226 neither writes nor reads these columns; apply only after no
-- older API that writes them is running. No supported environment runs one:
-- the release registry is empty and no durable environment is provisioned.
-- Irreversible: the dropped values (former teluni-aal2 step-up instants and
-- requested acr values) are not recoverable, and re-adding the columns would
-- not restore them. Both describe ephemeral authentication state: login
-- attempts expire within 10 minutes and ended sessions are deleted after 30
-- days, and no current rule, audit or report depends on them. No constraint
-- or index references either column. DROP COLUMN takes a brief ACCESS
-- EXCLUSIVE lock on each table and does not rewrite it.
ALTER TABLE "human_sessions" DROP COLUMN "strong_authenticated_at";
ALTER TABLE "oidc_login_attempts" DROP COLUMN "requested_assurance";
