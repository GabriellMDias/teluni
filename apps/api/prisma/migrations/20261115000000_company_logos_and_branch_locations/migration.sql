-- Additive metadata only: existing company/branch time zones and schedules
-- remain intact. Null location means it has not been selected yet.
BEGIN;
ALTER TABLE companies ADD COLUMN logo_data_url text;
ALTER TABLE companies ADD CONSTRAINT companies_logo_bounded_png CHECK
  (logo_data_url IS NULL OR (length(logo_data_url) <= 350000 AND logo_data_url LIKE 'data:image/png;base64,%'));
ALTER TABLE branches ADD COLUMN location jsonb;
ALTER TABLE branches ADD COLUMN address varchar(300);
ALTER TABLE branches ADD CONSTRAINT branches_location_object CHECK
  (location IS NULL OR jsonb_typeof(location) = 'object');
ALTER TABLE branches ADD CONSTRAINT branches_address_nonblank CHECK
  (address IS NULL OR length(btrim(address)) > 0);
COMMIT;
