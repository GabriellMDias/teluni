-- Reviewed identity schema: application principals and server-managed human
-- sessions (docs/project/identity-session-design.md). PostgreSQL owns the clock.
CREATE TYPE "PrincipalStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "HumanSessionState" AS ENUM ('PENDING_LIMIT', 'ACTIVE', 'REVOKED');

CREATE TABLE "principals" (
  "id" UUID NOT NULL,
  "issuer" VARCHAR(512) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "status" "PrincipalStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at" TIMESTAMPTZ(3),
  CONSTRAINT "principals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "principals_issuer_nonblank" CHECK ("issuer" ~ '^https?://[^[:space:]]+$'),
  CONSTRAINT "principals_subject_nonblank" CHECK ("subject" ~ '[^[:space:]]'),
  CONSTRAINT "principals_disabled_state" CHECK (("status" = 'DISABLED') = ("disabled_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "principals_issuer_subject_key" ON "principals"("issuer", "subject");

CREATE TABLE "human_sessions" (
  "id" UUID NOT NULL,
  "principal_id" UUID NOT NULL,
  "token_hash" BYTEA NOT NULL,
  "state" "HumanSessionState" NOT NULL,
  "provider_session_id" VARCHAR(255),
  "assurance_level" VARCHAR(64) NOT NULL,
  "authenticated_at" TIMESTAMPTZ(3) NOT NULL,
  "strong_authenticated_at" TIMESTAMPTZ(3),
  "idle_timeout_seconds" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "provider_tokens" BYTEA NOT NULL,
  "access_token_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "provider_checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refresh_lease_until" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" VARCHAR(32),
  CONSTRAINT "human_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "human_sessions_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "human_sessions_token_hash_sha256" CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "human_sessions_idle_bounds" CHECK ("idle_timeout_seconds" BETWEEN 60 AND 7200),
  CONSTRAINT "human_sessions_absolute_after_creation" CHECK ("absolute_expires_at" > "created_at" AND "absolute_expires_at" <= "created_at" + INTERVAL '12 hours'),
  CONSTRAINT "human_sessions_revocation_state" CHECK (("state" = 'REVOKED') = ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)),
  CONSTRAINT "human_sessions_revocation_reason_known" CHECK ("revocation_reason" IS NULL OR "revocation_reason" IN ('LOGOUT', 'TERMINATED_BY_USER', 'EXPIRED', 'REPLACED', 'PROVIDER_LOGOUT', 'PROVIDER_INACTIVE', 'REFRESH_REJECTED', 'PRINCIPAL_DISABLED', 'PRINCIPAL_MISMATCH'))
);
CREATE UNIQUE INDEX "human_sessions_token_hash_key" ON "human_sessions"("token_hash");
CREATE INDEX "human_sessions_principal_state_idx" ON "human_sessions"("principal_id", "state");
CREATE INDEX "human_sessions_provider_session_idx" ON "human_sessions"("provider_session_id");

CREATE TABLE "oidc_login_attempts" (
  "id" UUID NOT NULL,
  "handle_hash" BYTEA NOT NULL,
  "state" VARCHAR(128) NOT NULL,
  "secrets" BYTEA NOT NULL,
  "return_to" VARCHAR(2048) NOT NULL,
  "requested_assurance" VARCHAR(64),
  "max_age_seconds" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  CONSTRAINT "oidc_login_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oidc_login_attempts_max_age_bounds" CHECK ("max_age_seconds" IS NULL OR "max_age_seconds" >= 0),
  CONSTRAINT "oidc_login_attempts_handle_sha256" CHECK (octet_length("handle_hash") = 32),
  CONSTRAINT "oidc_login_attempts_state_nonblank" CHECK ("state" ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT "oidc_login_attempts_return_relative" CHECK ("return_to" ~ '^/'),
  CONSTRAINT "oidc_login_attempts_expiry_bounds" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + INTERVAL '10 minutes')
);
CREATE UNIQUE INDEX "oidc_login_attempts_handle_hash_key" ON "oidc_login_attempts"("handle_hash");

CREATE TABLE "backchannel_logout_replays" (
  "jti" VARCHAR(255) NOT NULL,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "backchannel_logout_replays_pkey" PRIMARY KEY ("jti"),
  CONSTRAINT "backchannel_logout_replays_expiry_after_receipt" CHECK ("expires_at" > "received_at")
);
