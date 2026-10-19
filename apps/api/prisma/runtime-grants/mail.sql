-- Least-privilege runtime access for the mail module. Producers insert in
-- their own transactions; the dispatcher updates delivery state, and deletes
-- only final messages once their retention period ends.
GRANT SELECT, INSERT ON outbound_emails TO orion_runtime;
GRANT UPDATE (sealed_secret, status, attempts, next_attempt_at, lease_expires_at, last_failure, last_reply_code, finalized_at) ON outbound_emails TO orion_runtime;
GRANT DELETE ON outbound_emails TO orion_runtime;
