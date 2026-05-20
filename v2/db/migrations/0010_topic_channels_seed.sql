-- =============================================================================
-- Tusk YT v2 — Topic / OAC channel seed
--
-- Idempotent seed of 31 Topic-class channels covering 28 unique artists
-- across TIPS modern catalog (Punjabi + Bollywood) + Saregama legacy
-- (1950s–1990s) + shared (omnipresent Bollywood vocalists/composers).
--
-- meta.kind discriminator:
--   - "topic_auto" — YouTube's auto-generated "{Artist} - Topic" channels
--                   (24 channels; aggregate audio-only versions of catalog
--                   tracks across labels)
--   - "oac"       — Official Artist Channels (7 channels; for modern artists
--                   where YT merged their Topic into their owned artist channel)
--
-- catalog_share weights are curated estimates of each label's share of the
-- artist's overall catalog. These are intentionally soft (refined later via
-- empirical Content ID data when available).
--
-- This file is idempotent — ON CONFLICT DO NOTHING means safe to re-apply.
-- Discovery process documented in v2/scripts/discover-topic-channels.ts.
-- =============================================================================

-- --- dim_channel rows ------------------------------------------------------
INSERT INTO dim_channel (channel_id, channel_name, channel_type, artist_name, ingest_videos, is_active, meta) VALUES
  -- TIPS-leaning Topic channels (modern catalog)
  ('UCuZiySVHbRuhCme46tGTOkw', 'Guru Randhawa - Topic',         'topic', 'Guru Randhawa',         false, true, '{"kind":"topic_auto"}'),
  ('UCJ2m-WpROlZCiZZID9r7NSQ', 'Diljit Dosanjh - Topic',        'topic', 'Diljit Dosanjh',        false, true, '{"kind":"topic_auto"}'),
  ('UC6GVOwH-1pughw5WYmjAolg', 'Rahat Fateh Ali Khan - Topic',  'topic', 'Rahat Fateh Ali Khan',  false, true, '{"kind":"topic_auto"}'),
  ('UC9KJWLlcGJeGlRAWbGvnRgw', 'Harrdy Sandhu - Topic',         'topic', 'Hardy Sandhu',          false, true, '{"kind":"topic_auto"}'),
  ('UCGPCYz1FTl_dvFFnzQTQzjw', 'Honey Singh - Topic',           'topic', 'Yo Yo Honey Singh',     false, true, '{"kind":"topic_auto"}'),
  -- Saregama-leaning Topic channels (legacy catalog)
  ('UCOq_phR9Fi_eUwNweVXlQIw', 'Lata Mangeshkar - Topic',       'topic', 'Lata Mangeshkar',       false, true, '{"kind":"topic_auto"}'),
  ('UCbp5cZLtFE6y7XdhvJeT0Qw', 'Asha Bhosle - Topic',           'topic', 'Asha Bhosle',           false, true, '{"kind":"topic_auto"}'),
  ('UCLpyDLYPCmQYxt_kkU1suhg', 'Mohammed Rafi - Topic',         'topic', 'Mohammed Rafi',         false, true, '{"kind":"topic_auto"}'),
  ('UC84y82gFQuX0jeqRSrkdERQ', 'Kishore Kumar - Topic',         'topic', 'Kishore Kumar',         false, true, '{"kind":"topic_auto"}'),
  ('UCfIz1rBXcbgR4D4QW_ee_1g', 'Mukesh - Topic',                'topic', 'Mukesh',                false, true, '{"kind":"topic_auto"}'),
  ('UC5QUNUnbJVJ1j5W3ct9HUeA', 'Manna Dey - Topic',             'topic', 'Manna Dey',             false, true, '{"kind":"topic_auto"}'),
  ('UCaKZl5l38GR-HCEv2gPlLXQ', 'R. D. Burman - Topic',          'topic', 'R. D. Burman',          false, true, '{"kind":"topic_auto"}'),
  ('UCyLlLf_1tSPom7l71lub4BA', 'Bappi Lahiri - Topic',          'topic', 'Bappi Lahiri',          false, true, '{"kind":"topic_auto"}'),
  ('UC_fQTVq1YAAjWAB3DrK5Zjw', 'Geeta Dutt - Topic',            'topic', 'Geeta Dutt',            false, true, '{"kind":"topic_auto"}'),
  ('UCyDwkSk8mP7Hg9g-nMqWfSA', 'Sandhya Mukherjee - Topic',     'topic', 'Sandhya Mukherjee',     false, true, '{"kind":"topic_auto"}'),
  -- Shared / omnipresent Topic channels
  ('UCrC-7fsdTCYeaRBpwA6j-Eg', 'Shreya Ghoshal - Topic',        'topic', 'Shreya Ghoshal',        false, true, '{"kind":"topic_auto"}'),
  ('UCsC4u-BJAd4OX1hJXtwXSOQ', 'Sonu Nigam - Topic',            'topic', 'Sonu Nigam',            false, true, '{"kind":"topic_auto"}'),
  ('UCDxKh1gFWeYsqePvgVzmPoQ', 'Arijit Singh - Topic',          'topic', 'Arijit Singh',          false, true, '{"kind":"topic_auto"}'),
  ('UC13ToEQgfmTe8_GW19LYtCg', 'Udit Narayan - Topic',          'topic', 'Udit Narayan',          false, true, '{"kind":"topic_auto"}'),
  ('UCptBkLZ6XRxoyn8SkUMc_Iw', 'Alka Yagnik - Topic',           'topic', 'Alka Yagnik',           false, true, '{"kind":"topic_auto"}'),
  ('UCQd9dydn5gaib_uuVVkYZTQ', 'Kumar Sanu - Topic',            'topic', 'Kumar Sanu',            false, true, '{"kind":"topic_auto"}'),
  ('UCDXM9wN1M6h7A9QGlaPbHEw', 'Anuradha Paudwal - Topic',      'topic', 'Anuradha Paudwal',      false, true, '{"kind":"topic_auto"}'),
  ('UCtJe0RYzgPddQXKtWduxz_w', 'A. R. Rahman - Topic',          'topic', 'A. R. Rahman',          false, true, '{"kind":"topic_auto"}'),
  ('UCcuXjaACiyViK8QTuztjR6A', 'Sachin-Jigar - Topic',          'topic', 'Sachin-Jigar',          false, true, '{"kind":"topic_auto"}'),
  -- Official Artist Channels (OACs) — modern artists where YT merged Topic
  ('UCF4uIIqbIy05Cmzx3rRt_8g', 'Atif Aslam',                    'topic', 'Atif Aslam',            false, true, '{"kind":"oac"}'),
  ('UC04aSzsN_7Ch_P7IGw13XKQ', 'The Mohit Chauhan',             'topic', 'Mohit Chauhan',         false, true, '{"kind":"oac"}'),
  ('UCLyUhS7B1oTDaplvMSuz7TA', 'Harrdy Sandhu',                 'topic', 'Hardy Sandhu',          false, true, '{"kind":"oac"}'),
  ('UC1KonH1j8WMhc5cT6Bp7NtA', 'Yo Yo Honey Singh',             'topic', 'Yo Yo Honey Singh',     false, true, '{"kind":"oac"}'),
  ('UCILTBQLmqF7nAJVenhPbXYA', 'Jubin Nautiyal',                'topic', 'Jubin Nautiyal',        false, true, '{"kind":"oac"}'),
  ('UCFrjzbol2Zy-FaKaCIKIDVA', 'Pritam',                        'topic', 'Pritam',                false, true, '{"kind":"oac"}'),
  ('UCpho9OjB5LS6xJ8sNSeNdsQ', 'A. R. Rahman',                  'topic', 'A. R. Rahman',          false, true, '{"kind":"oac"}')
ON CONFLICT (channel_id) DO NOTHING;

-- --- dim_artist_label rows ------------------------------------------------
INSERT INTO dim_artist_label (artist_name, company, catalog_share, notes) VALUES
  ('Guru Randhawa',        'TIPSMUSIC', 0.70, 'TIPS Punjabi flagship'),
  ('Diljit Dosanjh',       'TIPSMUSIC', 0.50, NULL),
  ('Rahat Fateh Ali Khan', 'TIPSMUSIC', 0.50, NULL),
  ('Atif Aslam',           'TIPSMUSIC', 0.70, 'TIPS has key film catalog'),
  ('Mohit Chauhan',        'TIPSMUSIC', 0.60, NULL),
  ('Hardy Sandhu',         'TIPSMUSIC', 0.80, 'TIPS Punjabi flagship'),
  ('Yo Yo Honey Singh',    'TIPSMUSIC', 0.60, NULL),
  ('Jubin Nautiyal',       'TIPSMUSIC', 0.50, NULL),
  ('Lata Mangeshkar',      'SAREGAMA',  0.85, 'Saregama owns HMV legacy'),
  ('Asha Bhosle',          'SAREGAMA',  0.85, NULL),
  ('Mohammed Rafi',        'SAREGAMA',  0.90, NULL),
  ('Kishore Kumar',        'SAREGAMA',  0.85, NULL),
  ('Mukesh',               'SAREGAMA',  0.90, NULL),
  ('Manna Dey',            'SAREGAMA',  0.90, NULL),
  ('R. D. Burman',         'SAREGAMA',  0.80, 'composer; many films via HMV'),
  ('Bappi Lahiri',         'SAREGAMA',  0.60, NULL),
  ('Geeta Dutt',           'SAREGAMA',  0.90, NULL),
  ('Sandhya Mukherjee',    'SAREGAMA',  0.90, 'Bengali catalog'),
  ('Shreya Ghoshal',       'TIPSMUSIC', 0.30, NULL),
  ('Shreya Ghoshal',       'SAREGAMA',  0.30, NULL),
  ('Sonu Nigam',           'TIPSMUSIC', 0.30, NULL),
  ('Sonu Nigam',           'SAREGAMA',  0.30, NULL),
  ('Arijit Singh',         'TIPSMUSIC', 0.30, NULL),
  ('Arijit Singh',         'SAREGAMA',  0.30, NULL),
  ('Udit Narayan',         'TIPSMUSIC', 0.30, NULL),
  ('Udit Narayan',         'SAREGAMA',  0.40, NULL),
  ('Alka Yagnik',          'TIPSMUSIC', 0.30, NULL),
  ('Alka Yagnik',          'SAREGAMA',  0.40, NULL),
  ('Kumar Sanu',           'TIPSMUSIC', 0.40, NULL),
  ('Kumar Sanu',           'SAREGAMA',  0.40, NULL),
  ('Anuradha Paudwal',     'TIPSMUSIC', 0.30, NULL),
  ('Anuradha Paudwal',     'SAREGAMA',  0.40, NULL),
  ('Pritam',               'TIPSMUSIC', 0.30, NULL),
  ('Pritam',               'SAREGAMA',  0.20, NULL),
  ('A. R. Rahman',         'TIPSMUSIC', 0.20, NULL),
  ('A. R. Rahman',         'SAREGAMA',  0.20, NULL),
  ('Sachin-Jigar',         'TIPSMUSIC', 0.30, NULL),
  ('Sachin-Jigar',         'SAREGAMA',  0.20, NULL)
ON CONFLICT (artist_name, company) DO NOTHING;
