-- Additive organization only: existing assets stay at the library root;
-- media bytes, asset identities and programming/publication references stay intact.
BEGIN;
CREATE TABLE media_folders (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  branch_id uuid,
  parent_id uuid,
  name varchar(120) NOT NULL,
  created_by_membership_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at timestamptz(3),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT media_folders_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT media_folders_company_id_branch_id_fkey FOREIGN KEY (company_id, branch_id)
    REFERENCES branches(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT media_folders_company_id_parent_id_fkey FOREIGN KEY (company_id, parent_id)
    REFERENCES media_folders(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT media_folders_creator_fkey FOREIGN KEY (company_id, created_by_membership_id)
    REFERENCES memberships(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT media_folders_name_valid CHECK (char_length(btrim(name)) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT media_folders_parent_not_self CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT media_folders_version_positive CHECK (version > 0)
);
CREATE INDEX media_folders_parent_name_idx ON media_folders(company_id, parent_id, name, id);
CREATE INDEX media_folders_company_created_idx ON media_folders(company_id, created_at);
ALTER TABLE media_assets ADD COLUMN folder_id uuid;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_folder_fkey FOREIGN KEY (company_id, folder_id)
  REFERENCES media_folders(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX media_assets_folder_created_idx ON media_assets(company_id, folder_id, created_at DESC, id DESC);
ALTER TABLE media_audit_events ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE media_audit_events ADD COLUMN folder_id uuid;
ALTER TABLE media_audit_events ADD CONSTRAINT media_audit_events_folder_fkey FOREIGN KEY (company_id, folder_id)
  REFERENCES media_folders(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE media_audit_events ADD CONSTRAINT media_audit_events_one_target CHECK (num_nonnulls(asset_id, folder_id) = 1);
CREATE TABLE media_library_operations (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  request_hash bytea NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT media_library_operations_pkey PRIMARY KEY (company_id, id),
  CONSTRAINT media_library_operations_actor_fkey FOREIGN KEY (company_id, actor_membership_id)
    REFERENCES memberships(company_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT media_library_operations_hash_length CHECK (octet_length(request_hash) = 32),
  CONSTRAINT media_library_operations_result_valid CHECK (jsonb_typeof(result) = 'object')
);
CREATE INDEX media_library_operations_created_idx ON media_library_operations(created_at);
COMMIT;
