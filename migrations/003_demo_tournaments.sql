-- Seeded fictional finished tournaments for the viral landing feed:
-- every completed speedmatch gets a clickable summary title so the homepage
-- reads like a highlight reel ("The Dutch Oven That Beat Three Humans").
--
-- summary_title is added here (additive migration) rather than editing 001,
-- so branch DBs replay cleanly. Demo rows carry full denormalized
-- entrants/matches (what the feed and My Matches read); tournaments.state is
-- a minimal terminal stub, never resumed (FINAL is terminal).

BEGIN;

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS summary_title text;

DO $$
DECLARE
  spec jsonb := '[
    {"category":"people","seeker":"Jordan","title":"The Cyclist Who Out-Pitched Everyone",
     "entrants":["Maya","Theo","Priya","Sam"],"winners":["Maya","Priya","Maya"]},
    {"category":"people","seeker":"Alexis","title":"Standup Robotics PhD Sweeps the Bracket",
     "entrants":["Priya","Sam","Theo","Maya"],"winners":["Priya","Theo","Priya"]},
    {"category":"products","seeker":"Morgan","title":"The Dutch Oven That Beat Three Gadgets",
     "entrants":["AeroPress Go","Framework 13","Le Creuset Dutch Oven","Anker 737"],
     "winners":["AeroPress Go","Le Creuset Dutch Oven","Le Creuset Dutch Oven"]},
    {"category":"products","seeker":"Riley","title":"Repairable Laptop Wins a 15-Second Spec War",
     "entrants":["Framework 13","Anker 737","AeroPress Go","Le Creuset Dutch Oven"],
     "winners":["Framework 13","AeroPress Go","Framework 13"]},
    {"category":"places","seeker":"Casey","title":"Kyoto Stole the Final at Dawn",
     "entrants":["Kyoto","Lisbon","Banff","Mexico City"],"winners":["Kyoto","Mexico City","Kyoto"]},
    {"category":"places","seeker":"Sasha","title":"Mexico City Talked Its Way Past the Mountains",
     "entrants":["Mexico City","Banff","Lisbon","Kyoto"],"winners":["Mexico City","Kyoto","Mexico City"]}
  ]'::jsonb;
  t jsonb;
  uid uuid;
  tid uuid;
  e uuid[];
  w1 uuid; w2 uuid; wf uuid;
  finished timestamptz;
  i int := 0;
BEGIN
  FOR t IN SELECT * FROM jsonb_array_elements(spec) LOOP
    i := i + 1;
    CONTINUE WHEN EXISTS (SELECT 1 FROM tournaments WHERE summary_title = t->>'title');

    SELECT array_agg(p.id ORDER BY ord) INTO e
      FROM jsonb_array_elements_text(t->'entrants') WITH ORDINALITY AS x(name, ord)
      JOIN personas p ON p.name = x.name AND p.category = t->>'category';
    IF array_length(e, 1) IS DISTINCT FROM 4 THEN
      RAISE EXCEPTION 'demo seed %: entrants not found', t->>'title';
    END IF;
    SELECT p.id INTO w1 FROM personas p WHERE p.name = t->'winners'->>0 AND p.category = t->>'category';
    SELECT p.id INTO w2 FROM personas p WHERE p.name = t->'winners'->>1 AND p.category = t->>'category';
    SELECT p.id INTO wf FROM personas p WHERE p.name = t->'winners'->>2 AND p.category = t->>'category';

    finished := now() - (i || ' hours')::interval;

    INSERT INTO users (display_name) VALUES (t->>'seeker') RETURNING id INTO uid;
    INSERT INTO tournaments (user_id, category, bracket_size, state, is_public, summary_title, winner_id, created_at, finished_at)
      VALUES (uid, t->>'category', 4,
              jsonb_build_object('phase', 'FINAL', 'bracketSize', 4, 'winner', wf, 'demo', true),
              true, t->>'title', wf, finished - interval '9 minutes', finished)
      RETURNING id INTO tid;

    INSERT INTO tournament_entrants (tournament_id, persona_id, seed)
      SELECT tid, e[n], n FROM generate_series(1, 4) n;

    INSERT INTO matches (tournament_id, round, match_index, entrant_a, entrant_b, winner, decided_at) VALUES
      (tid, 0, 0, e[1], e[2], w1, finished - interval '6 minutes'),
      (tid, 0, 1, e[3], e[4], w2, finished - interval '3 minutes'),
      (tid, 1, 0, w1,   w2,   wf, finished);
  END LOOP;
END $$;

COMMIT;
