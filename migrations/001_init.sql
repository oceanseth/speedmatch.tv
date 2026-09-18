-- speedmatch.tv initial schema
-- Convention (InstaCloud): every schema change is a file under migrations/ so
-- it replays on branch DBs and again on main after promotion.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Typed profile extracted from the onboarding conversation. NEVER store or
-- render the raw transcript into prompts (prompt-injection channel): the
-- extraction step validates against a schema and this table holds the result.
CREATE TABLE IF NOT EXISTS onboarding_profiles (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile        jsonb NOT NULL,
  -- Redacted subset safe to hand to a pitching agent (and audible to
  -- spectators). Built server-side; the full profile never leaves the server.
  public_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_consent  boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category   text NOT NULL CHECK (category IN ('people', 'products', 'places')),
  name       text NOT NULL,
  tagline    text NOT NULL DEFAULT '',
  -- System-prompt source material for the agent representing this persona.
  profile    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Boson voice: preset name (chloe/eleanor/jake/marcus/nora/oliver) or a
  -- registered voice_<id> from POST /v1/audio/voices.
  voice      text NOT NULL DEFAULT 'jake',
  image_url  text,
  -- Null for the seeded catalog; set when a real user creates a persona.
  owner_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, name)
);
CREATE INDEX IF NOT EXISTS personas_category_idx ON personas (category);

CREATE TABLE IF NOT EXISTS tournaments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('people', 'products', 'places')),
  bracket_size int  NOT NULL DEFAULT 4,
  -- Serialized TournamentState (server/src/tournament/machine.ts) — the
  -- machine is pure/JSON so the DB row is the single source of truth.
  state        jsonb NOT NULL,
  phase        text  NOT NULL DEFAULT 'LOBBY',
  winner_id    uuid REFERENCES personas(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS tournaments_user_idx ON tournaments (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tournament_entrants (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  persona_id    uuid NOT NULL REFERENCES personas(id),
  seed          int  NOT NULL,
  PRIMARY KEY (tournament_id, persona_id),
  UNIQUE (tournament_id, seed)
);

-- Denormalized match results for the "My Matches" tab: readable without
-- unpacking tournament state JSON.
CREATE TABLE IF NOT EXISTS matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round         int  NOT NULL,
  match_index   int  NOT NULL,
  entrant_a     uuid REFERENCES personas(id),
  entrant_b     uuid REFERENCES personas(id),
  winner        uuid REFERENCES personas(id),
  decided_at    timestamptz,
  UNIQUE (tournament_id, round, match_index)
);

-- Append-only event log per tournament: powers spectator catch-up/replay and
-- audit. seq is assigned server-side.
CREATE TABLE IF NOT EXISTS session_events (
  tournament_id uuid   NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  seq           bigint NOT NULL,
  type          text   NOT NULL,
  payload       jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, seq)
);

COMMIT;
