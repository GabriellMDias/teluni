-- Least-privilege runtime access for the media module. company_id, branch_id
-- and kind are never updatable (tenant immutability, fixed ownership scope)
-- and audit events are append-only. Assets are never deleted at runtime:
-- discarding and purging end in PURGED rows kept for audit. Object rows are
-- deleted by purge once no asset references them.
GRANT SELECT, INSERT, DELETE ON media_objects TO orion_runtime;
GRANT SELECT, INSERT ON media_assets TO orion_runtime;
GRANT UPDATE (name, tags, status, rejection_reason, original_sha256, display_sha256, thumbnail_sha256, width, height, duration_ms, has_audio, processing_stage, processing_progress, processing_attempts, lease_until, next_attempt_at, uploaded_at, ready_at, archived_at, deleted_at, purge_after, purged_at, version, updated_at) ON media_assets TO orion_runtime;
GRANT SELECT, INSERT ON media_audit_events TO orion_runtime;
-- Folder ownership and tenant keys are immutable; deletion keeps an audit tombstone.
GRANT SELECT, INSERT ON media_folders TO orion_runtime;
GRANT UPDATE (name, parent_id, deleted_at, version, updated_at) ON media_folders TO orion_runtime;
GRANT UPDATE (folder_id) ON media_assets TO orion_runtime;
-- Idempotency records are operational, retained for 30 days; audit stays append-only.
GRANT SELECT, INSERT, DELETE ON media_library_operations TO orion_runtime;
