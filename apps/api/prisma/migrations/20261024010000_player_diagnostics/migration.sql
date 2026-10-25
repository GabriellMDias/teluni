-- Expand only: nullable diagnostics preserve existing rows and old API writers.
-- Apply before deploying the updated API; deploy that API before the new player.
-- PostgreSQL adds the nullable columns without rewriting the table. ALTER TABLE
-- takes a brief exclusive lock; the check validates existing (all-null) rows.
-- No backfill can infer a player's clock assurance or crash count.
ALTER TABLE publication_device_states
  ADD COLUMN clock_state varchar(16),
  ADD COLUMN clock_skew_millis bigint,
  ADD COLUMN crash_count integer,
  ADD CONSTRAINT publication_device_states_diagnostics CHECK (
    (clock_state IS NULL AND clock_skew_millis IS NULL AND crash_count IS NULL)
    OR (
      clock_state IS NOT NULL AND clock_state IN ('ANCHORED', 'ESTIMATED', 'UNTRUSTED')
      AND (clock_skew_millis IS NULL OR (
        clock_state = 'ANCHORED' AND clock_skew_millis BETWEEN -9007199254740991 AND 9007199254740991
      ))
      AND (crash_count IS NULL OR crash_count >= 0)
    )
  );
