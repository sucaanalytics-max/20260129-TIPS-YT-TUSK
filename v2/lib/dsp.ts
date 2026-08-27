/**
 * DSP app registry — the source of truth for which store listings the
 * public-proxy crons pull. One entry per music DSP we track in India, with its
 * Apple App Store numeric id and Google Play package name.
 *
 * ⚠️ VERIFY store ids against the live stores before trusting the data — a
 * wrong id silently pulls the wrong app. `app_store_id` for Spotify (324684580)
 * was live-confirmed; the others are best-known and flagged `verified: false`
 * until a smoke run confirms them. The crons tolerate 404 / not-found per app
 * (treated as `skipped`, like SocialBlade's not-indexed channels), so an
 * unverified id degrades gracefully rather than failing the run.
 *
 * `dsp` matches dim_dsp.dsp so fct_app_proxy_daily rows join back to status.
 */

export interface DspApp {
  dsp: string;            // FK → dim_dsp.dsp
  display_name: string;
  app_store_id: string | null;  // Apple numeric id (for itunes lookup / RSS)
  play_package: string | null;  // Google Play package
  verified: boolean;      // has the id been confirmed against the live store?
}

export const DSP_APPS: DspApp[] = [
  { dsp: 'spotify',       display_name: 'Spotify',       app_store_id: '324684580',  play_package: 'com.spotify.music',                       verified: true },
  { dsp: 'jiosaavn',      display_name: 'JioSaavn',      app_store_id: '522847232',  play_package: 'com.jio.media.jiobeats',                  verified: false },
  { dsp: 'gaana',         display_name: 'Gaana',         app_store_id: '547287429',  play_package: 'com.gaana',                               verified: false },
  { dsp: 'youtube_music', display_name: 'YouTube Music', app_store_id: '1017492454', play_package: 'com.google.android.apps.youtube.music',   verified: false },
  { dsp: 'apple_music',   display_name: 'Apple Music',   app_store_id: '1108187390', play_package: 'com.apple.android.music',                 verified: false },
  { dsp: 'amazon_music',  display_name: 'Amazon Music',  app_store_id: '510855668',  play_package: 'com.amazon.mp3',                          verified: false },
];

export const TRACKED_COUNTRY = 'IN';
