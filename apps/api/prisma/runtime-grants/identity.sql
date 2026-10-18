-- Least-privilege runtime access for the identity module. Disposable test and
-- development databases apply every file in this folder to the restricted
-- runtime role after migrations. No runtime DELETE exists except for expired
-- logout-token replay records.
GRANT SELECT, INSERT ON principals TO orion_runtime;
GRANT UPDATE (status, disabled_at, display_name, verified_email) ON principals TO orion_runtime;
GRANT SELECT, INSERT ON human_sessions TO orion_runtime;
GRANT UPDATE (state, idle_timeout_seconds, last_activity_at, provider_tokens, access_token_expires_at, provider_checked_at, refresh_lease_until, revoked_at, revocation_reason) ON human_sessions TO orion_runtime;
GRANT SELECT, INSERT ON oidc_login_attempts TO orion_runtime;
GRANT UPDATE (consumed_at) ON oidc_login_attempts TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON backchannel_logout_replays TO orion_runtime;
