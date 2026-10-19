-- Nullable presentation snapshots keep existing principals valid. Identity is
-- still issuer + subject / principal UUID; these fields never link accounts or
-- authorize invitation acceptance. Refresh them only at verified login.
ALTER TABLE principals
  ADD COLUMN display_name varchar(200),
  ADD COLUMN verified_email varchar(320),
  ADD CONSTRAINT principals_display_name_nonblank CHECK (display_name IS NULL OR btrim(display_name) <> ''),
  ADD CONSTRAINT principals_verified_email_nonblank CHECK (verified_email IS NULL OR btrim(verified_email) <> '');
