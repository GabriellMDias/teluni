-- Least-privilege runtime access for the organizations module. company_id is
-- never updatable (tenant immutability), audit events are append-only and no
-- runtime DELETE exists. Each UPDATE grant serves a reviewed operation: settings, branch
-- lifecycle, membership status, grant revocation and responsibility transfer.
GRANT SELECT, INSERT ON companies TO orion_runtime;
GRANT UPDATE (display_name, status, default_locale, time_zone, version, updated_at) ON companies TO orion_runtime;
GRANT SELECT, INSERT ON branches TO orion_runtime;
GRANT UPDATE (name, time_zone, status, version, updated_at) ON branches TO orion_runtime;
GRANT SELECT, INSERT ON memberships TO orion_runtime;
GRANT UPDATE (status, version, updated_at) ON memberships TO orion_runtime;
GRANT SELECT, INSERT ON company_responsibilities TO orion_runtime;
GRANT UPDATE (membership_id, assigned_at) ON company_responsibilities TO orion_runtime;
GRANT SELECT, INSERT ON membership_grants TO orion_runtime;
GRANT UPDATE (revoked_at) ON membership_grants TO orion_runtime;
GRANT SELECT, INSERT ON membership_grant_branches TO orion_runtime;
GRANT SELECT, INSERT ON organization_audit_events TO orion_runtime;
GRANT SELECT, INSERT ON responsibility_transfers TO orion_runtime;
GRANT UPDATE (status, decided_at) ON responsibility_transfers TO orion_runtime;
