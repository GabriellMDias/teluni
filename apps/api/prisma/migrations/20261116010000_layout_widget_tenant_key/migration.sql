-- Keep the same tenant-safe identity key as every other company-owned table.
ALTER TABLE layout_qr_links ADD CONSTRAINT layout_qr_links_company_id_id_key UNIQUE (company_id, id);
