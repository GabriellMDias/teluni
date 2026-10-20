-- Least-privilege runtime access for the programming module. company_id and
-- the owning branch or source of a row are never updatable (tenant
-- immutability, fixed ownership) and audit events are append-only. Item,
-- span and rule lists are replaced as a whole by deleting and inserting
-- rows; playlists and groups are deleted only when unused, which cascades
-- to their items, spans and the group's program.
GRANT SELECT, INSERT, DELETE ON playlists TO orion_runtime;
GRANT UPDATE (name, transition, fade_ms, version, updated_at) ON playlists TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON playlist_items TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON programming_groups TO orion_runtime;
GRANT UPDATE (name, all_branches, version, updated_at) ON programming_groups TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON programming_group_branches TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON programs TO orion_runtime;
GRANT UPDATE (layout_id, version, updated_at) ON programs TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON program_outputs TO orion_runtime;
GRANT UPDATE (default_playlist_id) ON program_outputs TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON schedule_rules TO orion_runtime;
GRANT SELECT, INSERT ON programming_device_settings TO orion_runtime;
GRANT UPDATE (group_id, individual, version, updated_at) ON programming_device_settings TO orion_runtime;
GRANT SELECT, INSERT ON programming_audit_events TO orion_runtime;

-- Layouts: a save replaces the areas, view fields, pages and page
-- contents by deleting and inserting rows; only the layout row is updated.
GRANT SELECT, INSERT, DELETE ON layouts TO orion_runtime;
GRANT UPDATE (name, orientation, audio_mix_confirmed, version, updated_at) ON layouts TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON layout_areas TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON layout_view_fields TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON layout_pages TO orion_runtime;
GRANT SELECT, INSERT, DELETE ON layout_page_contents TO orion_runtime;
