-- Align the replay index with the actual list query: the public endpoints
-- order by finished_at DESC and filter is_public AND phase = 'FINAL', but
-- the original partial index covers (created_at DESC) WHERE is_public (kept —
-- the live feed still uses it). `phase` is a STORED generated column, so it
-- is valid in an index predicate.

BEGIN;

CREATE INDEX IF NOT EXISTS tournaments_public_final_idx
  ON tournaments (finished_at DESC)
  WHERE is_public AND phase = 'FINAL';

COMMIT;
