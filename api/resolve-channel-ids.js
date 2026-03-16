/**
 * One-time utility: resolves YouTube channel UCxxxxxx IDs from handles/names.
 * Does NOT write to the database — output is reviewed, then used to build seed-channels.js.
 *
 * Usage:
 *   GET /api/resolve-channel-ids?company=TIPSMUSIC
 *   GET /api/resolve-channel-ids?company=SAREGAMA
 *   GET /api/resolve-channel-ids?company=ALL
 *
 * Headers: Authorization: Bearer {CRON_SECRET}
 */

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Channel list with known handles where available.
// Handle = Social Blade / YouTube handle WITHOUT the @ prefix.
// If handle is null, falls back to a YouTube search by name.
const CHANNEL_LIST = {
  TIPSMUSIC: [
    { name: 'Tips Official',             handle: 'tipsofficial' },
    { name: "90's Gaane",                handle: '90sgaane' },
    { name: 'Volume',                    handle: null },
    { name: 'Tips Punjabi',              handle: 'tipspunjabi' },
    { name: 'Tips Telugu',               handle: 'tipstelugu' },
    { name: 'Tips Jhankaar Gaane',       handle: 'tipsjhankaar' },
    { name: 'Evergreen Bollywood Hits',  handle: null },
    { name: 'Tips Bhakti Prem',          handle: 'tipsbhaktiprem' },
    { name: 'Tips Films',                handle: 'tipsfilms' },
    { name: 'Bollywood Sadabahar',       handle: 'bollywoodsadabahar' },
    { name: 'Tips Tamil',               handle: 'tipstamil' },
    { name: 'Tips Bhojpuri',            handle: 'tipsbhojpuri' },
    { name: 'Tips Haryanvi',            handle: 'tipsharyanvi' },
    { name: 'Tips Gujarati',            handle: 'tipsgujarati' },
    { name: 'Tips Marathi',             handle: 'tipsmarathi' },
  ],
  SAREGAMA: [
    { name: 'Saregama',                         handle: 'saregama' },
    { name: 'Saregama Bhojpuri',               handle: 'saregamabhojpuri' },
    { name: 'Saregama TV Shows Tamil',          handle: null },
    { name: 'Saregama Telugu',                 handle: 'saregamatelugu' },
    { name: 'Saregama Tamil',                  handle: 'saregamatamil' },
    { name: 'Saregama Bengali',                handle: 'saregamabengali' },
    { name: 'Saregama Malayalam',              handle: 'saregamamalayalam' },
    { name: 'Saregama Marathi',                handle: 'saregamamarathi' },
    { name: 'Saregama Kannada',                handle: 'saregamakannada' },
    { name: 'Saregama Bhakti',                 handle: 'saregamabhakti' },
    { name: 'Saregama Gujarati',               handle: 'saregamagujarati' },
    { name: 'Saregama Punjabi',                handle: 'saregamapunjabi' },
    { name: 'Saregama Ghazal',                 handle: 'saregamaghazal' },
    { name: 'Saregama Karaoke',                handle: 'saregamakaraoke' },
    { name: 'Saregama Carnatic',               handle: 'saregamacarnatic' },
    { name: 'Saregama Kids',                   handle: 'saregamakids' },
    { name: 'Saregama Sufi',                   handle: 'saregamasufi' },
    { name: 'Saregama Regional',               handle: 'saregamaregional' },
    { name: 'Saregama Movies',                 handle: 'saregamamovies' },
    { name: 'Saregama Hindustani Classical',   handle: null },
    { name: 'Saregama Assamese',               handle: 'saregamaassamese' },
    { name: 'Saregama Haryanvi',               handle: 'saregamaharyanvi' },
    { name: 'Yoodlee Films',                   handle: 'yoodleefilms' },
  ],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader?.replace('Bearer ', '') !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!YOUTUBE_API_KEY) {
    return res.status(500).json({ success: false, error: 'YOUTUBE_API_KEY not configured' });
  }

  const companyParam = (req.query.company || 'ALL').toUpperCase();
  const companies = companyParam === 'ALL'
    ? ['TIPSMUSIC', 'SAREGAMA']
    : [companyParam];

  const results = [];

  for (const company of companies) {
    const channels = CHANNEL_LIST[company];
    if (!channels) continue;

    for (const ch of channels) {
      try {
        let channelId = null;
        let resolvedTitle = null;

        if (ch.handle) {
          // Preferred: resolve by handle (1 quota unit)
          const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=@${ch.handle}&key=${YOUTUBE_API_KEY}`;
          const resp = await fetch(url);
          const data = await resp.json();
          const item = data.items?.[0];
          if (item) {
            channelId = item.id;
            resolvedTitle = item.snippet?.title;
          }
        }

        if (!channelId) {
          // Fallback: search by name (100 quota units — use sparingly)
          console.log(`⚠️  Handle lookup failed for "${ch.name}", falling back to search`);
          const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(ch.name)}&key=${YOUTUBE_API_KEY}`;
          const resp = await fetch(url);
          const data = await resp.json();
          const item = data.items?.[0];
          if (item) {
            channelId = item.snippet?.channelId;
            resolvedTitle = item.snippet?.channelTitle;
          }
        }

        results.push({
          company,
          name: ch.name,
          handle: ch.handle,
          channelId: channelId || 'NOT_FOUND',
          resolvedTitle: resolvedTitle || null,
          verifyUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : null,
          status: channelId ? 'ok' : 'not_found',
        });

      } catch (err) {
        results.push({
          company,
          name: ch.name,
          handle: ch.handle,
          channelId: null,
          status: 'error',
          error: err.message,
        });
      }
    }
  }

  const found = results.filter(r => r.status === 'ok').length;
  const notFound = results.filter(r => r.status !== 'ok').length;

  return res.status(200).json({
    success: true,
    summary: { total: results.length, found, notFound },
    results,
    nextStep: 'Review verifyUrl links for each channel, then copy channelId values into seed-channels.js',
  });
}
