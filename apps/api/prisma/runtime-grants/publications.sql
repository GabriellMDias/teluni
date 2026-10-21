-- Least-privilege runtime access for the publications module. A
-- publication's content, digests, program and publisher are never
-- updatable: the runtime role only marks it superseded and prunes it
-- (clearing its manifest and deleting its media references). Playlist
-- copies and audit events are append-only. Screen states are overwritten by
-- each report; report transitions are deleted after their retention.
-- Publications are deleted only with their program, by the cascade of
-- deleting a group.
GRANT SELECT, INSERT ON publications TO orion_runtime;
GRANT UPDATE (superseded_at, pruned_at, manifest) ON publications TO orion_runtime;
GRANT SELECT, INSERT ON publication_playlists TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON publication_media TO orion_runtime;
GRANT SELECT, INSERT ON publication_device_states TO orion_runtime;
GRANT UPDATE (received_at, protocol, app_version, desired_publication_id,
  active_publication_id, active_since, recovery_publication_id,
  staging_publication_id, staging_state, staging_failure, staging_bytes_done,
  staging_bytes_total, playback, storage_free_bytes, storage_total_bytes,
  device_time) ON publication_device_states TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON publication_device_events TO orion_runtime;
GRANT SELECT, INSERT ON publication_audit_events TO orion_runtime;
-- A publication's catalog copies are recorded with it and never change.
-- Price publication intents coalesce, are claimed, finish and, once
-- finished, are deleted after their retention; their program, catalog and
-- creation never change.
GRANT SELECT, INSERT ON publication_catalogs TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON price_publication_intents TO orion_runtime;
GRANT UPDATE (price_sequence, author_membership_id, authorized_by_membership_id,
  state, reason, attempts, next_attempt_at, lease_expires_at, publication_id,
  updated_at) ON price_publication_intents TO orion_runtime;
