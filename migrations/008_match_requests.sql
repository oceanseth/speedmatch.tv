-- Preserve each completed matching request, independently of account defaults.
BEGIN;
CREATE TABLE IF NOT EXISTS match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  legacy boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_requests_owner_idx ON match_requests(user_id, created_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS match_requests_legacy_idx ON match_requests(user_id) WHERE legacy;
-- Existing preferences become the first history entry, never silently disappear.
INSERT INTO match_requests(user_id, profile, legacy, created_at)
SELECT user_id, profile, true, updated_at FROM onboarding_profiles
ON CONFLICT (user_id) WHERE legacy DO NOTHING;
-- Private server-owned snapshot. Never add it to public event/state payloads.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS match_request_id uuid REFERENCES match_requests(id) ON DELETE SET NULL;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS match_context jsonb;
COMMIT;
