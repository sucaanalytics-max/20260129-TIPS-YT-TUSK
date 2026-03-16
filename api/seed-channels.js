/**
 * One-time: seeds the youtube_channels registry with all 38 verified channel IDs.
 *
 * HOW TO USE:
 *  1. Deploy resolve-channel-ids.js and call GET /api/resolve-channel-ids?company=ALL
 *  2. For each result, open the verifyUrl to confirm it's the correct channel
 *  3. Replace the placeholder 'RESOLVE_ME' values below with verified UCxxxxxx IDs
 *  4. Call GET /api/seed-channels  (Authorization: Bearer {CRON_SECRET})
 *
 * Safe to re-run: uses upsert with onConflict: 'channel_id'
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bfafqccvzboyfjewzvhk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// ============================================================
// UPDATE THESE CHANNEL IDs after running resolve-channel-ids
// channel_id = YouTube UCxxxxxx ID
// handle     = Social Blade query string (handle WITHOUT @)
// ============================================================
const CHANNELS = [
  // --- TIPS MUSIC (15 channels) ---
  { channel_id: 'UCJrDMFOdv1I2k8n9oK_V21w', channel_name: 'Tips Official',            company: 'TIPSMUSIC', handle: 'tipsofficial' },
  { channel_id: 'UC37cflt9I_ER6Z0YQUdJGBw', channel_name: "90's Gaane",                company: 'TIPSMUSIC', handle: '90sgaane' },
  { channel_id: 'UC9h5YEjla8WeIIsifbf84_Q', channel_name: 'Volume',                    company: 'TIPSMUSIC', handle: 'volume' },
  { channel_id: 'UCF8Ar7alYrtOI5SF6b7T0xA', channel_name: 'Tips Punjabi',              company: 'TIPSMUSIC', handle: 'tipspunjabi' },
  { channel_id: 'UC2V5vzgmEmoiWqXfM2jN5_w', channel_name: 'Tips Telugu',               company: 'TIPSMUSIC', handle: 'tipstelugu' },
  { channel_id: 'UCFNHLC4euNaQGDmIokMugiA', channel_name: 'Tips Jhankaar Gaane',       company: 'TIPSMUSIC', handle: 'tipsjhankaar' },
  { channel_id: 'UCOn5Bj5jcQkVpx7pzxP3PDw', channel_name: 'Evergreen Bollywood Hits',  company: 'TIPSMUSIC', handle: 'evergreenbollywoodhits' },
  { channel_id: 'UCCbmKsQJ92JV-L8jYJ4u9Yg', channel_name: 'Tips Bhakti Prem',          company: 'TIPSMUSIC', handle: 'tipsbhaktiprem' },
  { channel_id: 'UCqXO3ktBw0D0sw1z5hZFeDg', channel_name: 'Tips Films',                company: 'TIPSMUSIC', handle: 'tipsfilms' },
  { channel_id: 'UCwhvGgGNRm18Gv9cHSbwNtw', channel_name: 'Bollywood Sadabahar',       company: 'TIPSMUSIC', handle: 'bollywoodsadabahar' },
  { channel_id: 'UC48pE7QE4NZFTCsHT-IRxJw', channel_name: 'Tips Tamil',                company: 'TIPSMUSIC', handle: 'tipstamil' },
  { channel_id: 'UCTHUx9uIBkpy8Z9OiKzMz0A', channel_name: 'Tips Bhojpuri',             company: 'TIPSMUSIC', handle: 'tipsbhojpuri' },
  { channel_id: 'UCCOygJTrBqQbClJKLoKgKfw', channel_name: 'Tips Haryanvi',             company: 'TIPSMUSIC', handle: 'tipsharyanvi' },
  { channel_id: 'UCbIHXx0FVQCXG1fhkgnJINw', channel_name: 'Tips Gujarati',             company: 'TIPSMUSIC', handle: 'tipsgujarati' },
  { channel_id: 'UCdKTnvHFf67M1UrW3qbe-Dg', channel_name: 'Tips Marathi',              company: 'TIPSMUSIC', handle: 'tipsmarathi' },

  // --- SAREGAMA (23 channels) ---
  { channel_id: 'UC_A7K2dXFsTMAciGmnNxy-Q', channel_name: 'Saregama',                          company: 'SAREGAMA', handle: 'saregama' },
  { channel_id: 'UC0J8BQahplvTY6LjlnLf_NQ', channel_name: 'Saregama Bhojpuri',                 company: 'SAREGAMA', handle: 'saregamahumbhojpuri' },
  { channel_id: 'UCtrovMbRR6h_XLMfdbhqb1A', channel_name: 'Saregama TV Shows Tamil',            company: 'SAREGAMA', handle: 'saregamatvshowstamil' },
  { channel_id: 'UC68nKdrLbLL0Vj7ilVkLmmg', channel_name: 'Saregama Telugu',                   company: 'SAREGAMA', handle: 'saregamatelugu' },
  { channel_id: 'UCzee67JnEcuvjErRyWP3GpQ', channel_name: 'Saregama Tamil',                    company: 'SAREGAMA', handle: 'saregamatamil' },
  { channel_id: 'UCRh-4WUJx8M86gUYL2pyKSQ', channel_name: 'Saregama Bengali',                  company: 'SAREGAMA', handle: 'saregamabengali' },
  { channel_id: 'UCoRF8GByEjmM_yHwUGIDGyQ', channel_name: 'Saregama Malayalam',                company: 'SAREGAMA', handle: 'saregamamalayalam' },
  { channel_id: 'UCJSX0gNr2U5lawLXE6IjRmA', channel_name: 'Saregama Marathi',                  company: 'SAREGAMA', handle: 'saregamamarathi' },
  { channel_id: 'UCKFnbjBQDzzh002TMJcyuZA', channel_name: 'Saregama Kannada',                  company: 'SAREGAMA', handle: 'saregamakannada' },
  { channel_id: 'UC6vQRTCxutg6fJLUGkDKynQ', channel_name: 'Saregama Bhakti',                   company: 'SAREGAMA', handle: 'saregamabhakti' },
  { channel_id: 'UCvrD1eyGgo8O9JcTraCvYBg', channel_name: 'Saregama Gujarati',                 company: 'SAREGAMA', handle: 'saregamagujarati' },
  { channel_id: 'UCSdWkYk9pk3DHTXbof_R7XQ', channel_name: 'Saregama Punjabi',                  company: 'SAREGAMA', handle: 'saregamapunjabi' },
  { channel_id: 'UCcfQ2IQNVoAb7znCP2dlIqw', channel_name: 'Saregama Ghazal',                   company: 'SAREGAMA', handle: 'saregamaghazal' },
  { channel_id: 'UCpQiC_zElVHhNm58uwCi7Gw', channel_name: 'Saregama Karaoke',                  company: 'SAREGAMA', handle: 'saregamakaraoke' },
  { channel_id: 'UC6-4EXwd60J6cfJPttOHd3A', channel_name: 'Saregama Carnatic',                 company: 'SAREGAMA', handle: 'saregamacarnatic' },
  { channel_id: 'UC7KNSypmtecKCEXpmtyh8jQ', channel_name: 'Saregama Kids',                     company: 'SAREGAMA', handle: 'saregamakids' },
  { channel_id: 'UC76TspUE4-LJgLN-7JCcUvg', channel_name: 'Saregama Sufi',                     company: 'SAREGAMA', handle: 'saregamasufi' },
  { channel_id: 'UCZZSschh7IG4n0jCj9zD55w', channel_name: 'Saregama Regional',                 company: 'SAREGAMA', handle: 'saregamaregional' },
  { channel_id: 'UCgo7B-9h9MsXXV8B8oQKzgw', channel_name: 'Saregama Movies',                   company: 'SAREGAMA', handle: 'saregamamovies' },
  { channel_id: 'UCjm_2mMYXUEjWzSVsA6Wshg', channel_name: 'Saregama Hindustani Classical',      company: 'SAREGAMA', handle: 'saregamahindustaniclassical' },
  { channel_id: 'UCEb756VyJmgWoHLbhBD76_w', channel_name: 'Saregama Assamese',                 company: 'SAREGAMA', handle: 'saregamaassamese' },
  { channel_id: 'UC_HNOL9DxoF8aYYN3kDv2Eg', channel_name: 'Saregama Haryanvi',                 company: 'SAREGAMA', handle: 'saregamaharyanvi' },
  { channel_id: 'UCeyLWXudxRp7d8JiG-nGq1w', channel_name: 'Yoodlee Films',                     company: 'SAREGAMA', handle: 'yoodleefilms' },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader?.replace('Bearer ', '') !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ success: false, error: 'SUPABASE_SERVICE_KEY not configured' });
  }

  // Refuse to seed if any channel still has placeholder ID
  const unresolved = CHANNELS.filter(c => c.channel_id === 'RESOLVE_ME');
  if (unresolved.length > 0) {
    return res.status(400).json({
      success: false,
      error: `${unresolved.length} channel(s) still have placeholder IDs. Run /api/resolve-channel-ids first.`,
      unresolved: unresolved.map(c => c.channel_name),
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data, error } = await supabase
    .from('youtube_channels')
    .upsert(CHANNELS, { onConflict: 'channel_id' })
    .select();

  if (error) {
    console.error('Seed error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.status(200).json({
    success: true,
    message: `Seeded ${data.length} channels`,
    channels: data.map(c => ({ channel_id: c.channel_id, channel_name: c.channel_name, company: c.company })),
  });
}
