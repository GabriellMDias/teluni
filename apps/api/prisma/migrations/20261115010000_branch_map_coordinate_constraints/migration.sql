-- Complete the additive location expansion with map-point invariants. Legacy
-- branches have a null location and keep their existing zone and address.
BEGIN;
ALTER TABLE branches ADD CONSTRAINT branches_location_coordinates CHECK (
  location IS NULL OR (
    location ?& ARRAY['latitude', 'longitude']
    AND jsonb_typeof(location->'latitude') = 'number'
    AND jsonb_typeof(location->'longitude') = 'number'
    AND (location->>'latitude')::numeric BETWEEN -90 AND 90
    AND (location->>'longitude')::numeric BETWEEN -180 AND 180
  )
);
ALTER TABLE branches ADD CONSTRAINT branches_located_address_required CHECK (
  location IS NULL OR (address IS NOT NULL AND length(btrim(address)) > 0)
);
COMMIT;
