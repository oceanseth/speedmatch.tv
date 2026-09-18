-- Seeded persona catalog (default until "real users vs seeded" is answered).
-- Voice mapping per the channel design discussion: jake = energetic/consumer,
-- marcus = technical, eleanor = premium/calm, nora = narrative places,
-- oliver = reflective places, chloe = people.

BEGIN;

INSERT INTO personas (category, name, tagline, voice, profile) VALUES
  ('people',   'Maya',           'Documentary editor who plans trips around food markets', 'chloe',
   '{"interests": ["street food", "film", "trail running"], "pitch_style": "warm, curious"}'),
  ('people',   'Theo',           'Ex-touring bassist, now teaches kids music',              'oliver',
   '{"interests": ["vinyl", "cycling", "cooking"], "pitch_style": "laid-back, funny"}'),
  ('people',   'Priya',          'Robotics PhD who does standup on weekends',               'nora',
   '{"interests": ["robots", "comedy", "bouldering"], "pitch_style": "sharp, playful"}'),
  ('people',   'Sam',            'Park ranger who has read every Le Guin novel',            'marcus',
   '{"interests": ["hiking", "sci-fi", "birding"], "pitch_style": "calm, sincere"}'),

  ('products', 'AeroPress Go',   'The travel coffee maker that fits in a mug',              'jake',
   '{"archetype": "energetic consumer", "hooks": ["90-second brew", "fits anywhere"]}'),
  ('products', 'Framework 13',   'The laptop you can actually repair',                      'marcus',
   '{"archetype": "technical", "hooks": ["swappable ports", "user-replaceable everything"]}'),
  ('products', 'Le Creuset Dutch Oven', 'Buy it once, cook for fifty years',                'eleanor',
   '{"archetype": "premium", "hooks": ["lifetime warranty", "heirloom"]}'),
  ('products', 'Anker 737',      'A power bank that laughs at dead batteries',              'jake',
   '{"archetype": "energetic consumer", "hooks": ["charges a laptop", "airport savior"]}'),

  ('places',   'Kyoto',          'Temples at dawn, ramen at midnight',                      'nora',
   '{"vibe": "serene", "hooks": ["Fushimi Inari before sunrise", "kissaten coffee"]}'),
  ('places',   'Lisbon',         'Hills, tiles, and pastel de nata',                        'nora',
   '{"vibe": "sunlit", "hooks": ["tram 28", "miradouro sunsets"]}'),
  ('places',   'Banff',          'Turquoise lakes with a mountain problem',                 'oliver',
   '{"vibe": "awe", "hooks": ["Moraine Lake", "larch season"]}'),
  ('places',   'Mexico City',    'Art, tacos, and 700 years of history',                    'oliver',
   '{"vibe": "electric", "hooks": ["Chapultepec", "al pastor at 2am"]}')
ON CONFLICT DO NOTHING;

COMMIT;
