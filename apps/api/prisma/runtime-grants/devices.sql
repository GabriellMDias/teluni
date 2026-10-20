-- Least-privilege runtime access for the devices module. company_id is never
-- updatable (tenant immutability) and audit events are append-only. Each
-- UPDATE grant serves a reviewed operation: enrollment claim and polling,
-- device configuration, move, unlink, erasure, check-in and credential
-- rotation. Expired enrollments and claim-failure counters are purged.
GRANT SELECT, INSERT ON device_enrollments TO orion_runtime;
GRANT UPDATE (status, claimed_at, last_polled_at) ON device_enrollments TO orion_runtime;
GRANT DELETE ON device_enrollments TO orion_runtime;
GRANT SELECT, INSERT ON devices TO orion_runtime;
GRANT UPDATE (branch_id, name, time_zone, rotation, status, erasure, credential_hash, next_credential_hash, report, last_seen_at, revoked_at, erasure_recorded_at, version, updated_at) ON devices TO orion_runtime;
GRANT SELECT, INSERT ON device_claim_failures TO orion_runtime;
GRANT DELETE ON device_claim_failures TO orion_runtime;
GRANT SELECT, INSERT ON device_audit_events TO orion_runtime;
