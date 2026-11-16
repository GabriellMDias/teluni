-- Expand the existing area model; existing rows and publications are unchanged.
ALTER TYPE "LayoutAreaKind" ADD VALUE 'WIDGET';
ALTER TABLE layout_areas ADD COLUMN widget jsonb;
ALTER TABLE layout_areas ADD CONSTRAINT layout_areas_widget CHECK (
  (kind::text = 'WIDGET') = (widget IS NOT NULL)
  AND (widget IS NULL OR (
    jsonb_typeof(widget) = 'object'
    AND widget ?& ARRAY['version', 'type']
    AND COALESCE(widget->'version' = '1'::jsonb, false)
    AND COALESCE(widget->>'type' IN ('clock', 'qr', 'ticker', 'weather', 'rss'), false)
    AND octet_length(widget::text) <= 16384
    AND NOT page_controlled AND muted AND volume = 0
  ))
);
CREATE TABLE layout_qr_links (
  id varchar(32) PRIMARY KEY,
  company_id uuid NOT NULL,
  layout_id uuid NOT NULL,
  area_key varchar(16) NOT NULL,
  target_url varchar(2048) NOT NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT layout_qr_links_layout_fkey FOREIGN KEY (company_id, layout_id)
    REFERENCES layouts (company_id, id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT layout_qr_links_area_key UNIQUE (company_id, layout_id, area_key),
  CONSTRAINT layout_qr_links_id_shape CHECK (id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT layout_qr_links_key_shape CHECK (area_key ~ '^[a-z][a-z0-9-]{0,15}$'),
  CONSTRAINT layout_qr_links_target_shape CHECK (target_url LIKE 'https://%' AND char_length(target_url) <= 2048)
);

-- Layouts with widgets use a new manifest format; protocols 1 and 2 remain supported.
ALTER TABLE publications DROP CONSTRAINT publications_protocol_known;
ALTER TABLE publications ADD CONSTRAINT publications_protocol_known CHECK (protocol IN (1, 2, 3));
