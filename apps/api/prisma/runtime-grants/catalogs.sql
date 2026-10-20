-- Least-privilege runtime access for the catalogs module. company_id, the
-- owning branch, a field's catalog, type, currency and reference target,
-- and a record's catalog are never updatable (tenant immutability, fixed
-- ownership, immutable field meaning), and audit events are append-only.
-- Overrides, record media and record references are replaced by deleting
-- and inserting rows; promotions are created and deleted, never edited.
-- Fields are deleted only while nothing holds a value for them, records
-- only while nothing references them, and catalogs only when empty.
GRANT SELECT, INSERT, DELETE ON catalogs TO orion_runtime;
GRANT UPDATE (name, status, version, schema_version, updated_at) ON catalogs TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON catalog_fields TO orion_runtime;
GRANT UPDATE (position, label, required, settings, archived_at) ON catalog_fields TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON catalog_records TO orion_runtime;
GRANT UPDATE (position, available, field_values, version, updated_by_membership_id, updated_at) ON catalog_records TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON catalog_price_overrides TO orion_runtime;
GRANT UPDATE (amount, updated_at) ON catalog_price_overrides TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON catalog_promotions TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON catalog_record_media TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON catalog_record_references TO orion_runtime;
GRANT SELECT, INSERT ON catalog_audit_events TO orion_runtime;
