-- =============================================================================
-- Tusk YT v2 — Frozen-viewCount detection + delta repair (E1)
--
-- YouTube's Data API intermittently serves a STALE cumulative viewCount: the
-- identical number for consecutive days, then it unfreezes and the whole
-- backlog arrives in one reading. Measured across this table's history:
-- 604 frozen channel-days over 106 distinct dates (~4.7% of all channel-days).
-- When every owned channel freezes at once the company aggregate goes flat too
-- (2026-05-21, 2026-06-24, and consecutively 2026-08-02/03).
--
-- The old ingest wrote that zero delta as a factual 0, which asserts "nobody
-- watched" — certainly false — and then attributed the entire backlog to the
-- unfreeze day (the real 2026-08-04 landed at +11.5 sigma for TIPSMUSIC).
--
-- Rule, matching lib/view-delta.ts exactly:
--   * a zero delta means we learned NOTHING that day  -> daily_views = NULL
--   * a negative delta (counter reset) is unknowable  -> NULL, and it BREAKS
--     the run so a later delta is never smeared across it
--   * when a plateau breaks, the backlog is spread evenly over the days it
--     truly covers, remainder on the final day so the sum is preserved EXACTLY
--
-- total_views (the raw API reading) is never modified — only the derived
-- daily_views, plus provenance columns so imputed days can never be passed off
-- as measured.
-- =============================================================================

ALTER TABLE fct_channel_daily
  ADD COLUMN IF NOT EXISTS daily_views_imputed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delta_span_days     int;

COMMENT ON COLUMN fct_channel_daily.daily_views_imputed IS
  'daily_views was derived by spreading a multi-day catch-up delta, not measured as a 1-day delta. Surface this; never present it as measured.';
COMMENT ON COLUMN fct_channel_daily.delta_span_days IS
  'Days the underlying cumulative delta actually covered. 1 = ordinary day; NULL = not computable.';

CREATE INDEX IF NOT EXISTS idx_fct_channel_daily_imputed
  ON fct_channel_daily (date DESC) WHERE daily_views_imputed;

-- --- Repair function --------------------------------------------------------
-- Deliberately a per-channel loop rather than window functions: it mirrors
-- lib/view-delta.ts statement for statement, so the two cannot drift on the
-- edge cases (run broken by a reset, unresolved trailing freeze, first row).
-- Idempotent — it recomputes everything from total_views, so it is safe to
-- re-run at any time.
CREATE OR REPLACE FUNCTION repair_view_deltas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  max_plausible constant bigint := 200000000;  -- = MAX_PLAUSIBLE_DAILY_VIEWS
  ch           record;
  r            record;
  prev_total   bigint;
  anchor_date  date;      -- date of the last usable, non-frozen reading
  pending      date[];
  dv           bigint;
  rows_covered int;
  span         int;
  base         bigint;
  remainder    bigint;
  i            int;
  updated      int := 0;
BEGIN
  FOR ch IN SELECT DISTINCT f.channel_id AS cid FROM fct_channel_daily f LOOP
    prev_total := NULL;
    anchor_date := NULL;
    pending := ARRAY[]::date[];

    FOR r IN SELECT f.date AS d, f.total_views AS tv
               FROM fct_channel_daily f
              WHERE f.channel_id = ch.cid
              ORDER BY f.date
    LOOP
      IF prev_total IS NULL OR r.tv IS NULL THEN
        UPDATE fct_channel_daily
           SET daily_views = NULL, daily_views_imputed = false, delta_span_days = NULL
         WHERE channel_id = ch.cid AND date = r.d;
        updated := updated + 1;
        pending := ARRAY[]::date[];
        IF r.tv IS NOT NULL THEN anchor_date := r.d; END IF;
      ELSE
        dv := r.tv - prev_total;

        IF dv = 0 THEN
          -- Frozen: hold open, and do NOT advance the anchor.
          UPDATE fct_channel_daily
             SET daily_views = NULL, daily_views_imputed = false, delta_span_days = NULL
           WHERE channel_id = ch.cid AND date = r.d;
          updated := updated + 1;
          pending := pending || r.d;

        ELSIF dv < 0 THEN
          -- Counter reset / upstream correction. Unknowable, and it breaks the
          -- run: anything pending before it must NOT absorb a later delta.
          UPDATE fct_channel_daily
             SET daily_views = NULL, daily_views_imputed = false, delta_span_days = NULL
           WHERE channel_id = ch.cid AND date = r.d;
          updated := updated + 1;
          pending := ARRAY[]::date[];
          anchor_date := r.d;

        ELSE
          rows_covered := COALESCE(array_length(pending, 1), 0) + 1;
          -- Span is CALENDAR days from the last usable reading, not rows held.
          span := COALESCE(r.d - anchor_date, rows_covered);
          IF span < 1 THEN span := rows_covered; END IF;

          IF (dv::numeric / span) > max_plausible THEN
            -- Catalog restatement, not viewership. Strand the pending run.
            UPDATE fct_channel_daily
               SET daily_views = NULL, daily_views_imputed = false, delta_span_days = NULL
             WHERE channel_id = ch.cid AND date = r.d;
            updated := updated + 1;

          ELSIF span <> rows_covered OR span = 1 THEN
            -- Rows missing for part of the span: keep the value whole so the
            -- total is never lost; delta_span_days carries the caveat.
            UPDATE fct_channel_daily
               SET daily_views = dv, daily_views_imputed = false, delta_span_days = span
             WHERE channel_id = ch.cid AND date = r.d;
            updated := updated + 1;

          ELSE
            base := dv / span;                 -- dv >= 0, so trunc == floor
            remainder := dv - base * span;
            FOR i IN 1 .. (span - 1) LOOP
              UPDATE fct_channel_daily
                 SET daily_views = base, daily_views_imputed = true, delta_span_days = span
               WHERE channel_id = ch.cid AND date = pending[i];
              updated := updated + 1;
            END LOOP;
            UPDATE fct_channel_daily
               SET daily_views = base + remainder, daily_views_imputed = true, delta_span_days = span
             WHERE channel_id = ch.cid AND date = r.d;
            updated := updated + 1;
          END IF;

          pending := ARRAY[]::date[];
          anchor_date := r.d;
        END IF;
      END IF;

      IF r.tv IS NOT NULL THEN
        prev_total := r.tv;
      END IF;
    END LOOP;
  END LOOP;

  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION repair_view_deltas() FROM PUBLIC;
REVOKE ALL ON FUNCTION repair_view_deltas() FROM anon, authenticated;

-- --- Surface imputation through the company rollup --------------------------
-- Additive: existing consumers select named columns, so appending is safe.
CREATE OR REPLACE VIEW v_company_daily AS
 SELECT f.date,
    c.company,
    sum(f.daily_views) AS daily_views,
    sum(f.daily_subscribers) AS daily_subscribers,
    sum(f.daily_videos) AS daily_videos,
    sum(f.total_views) AS total_views,
    sum(f.subscribers) AS subscribers,
    count(DISTINCT f.channel_id) AS channels_with_data,
    count(*) FILTER (WHERE f.daily_views_imputed) AS imputed_channels
   FROM fct_channel_daily f
     JOIN dim_channel c ON c.channel_id = f.channel_id
  WHERE c.is_active = true AND c.channel_type = 'owned'::text AND c.company IS NOT NULL
  GROUP BY f.date, c.company
UNION ALL
 SELECT f.date,
    c.company,
    sum(f.daily_views) AS daily_views,
    sum(f.daily_subscribers) AS daily_subscribers,
    sum(f.daily_videos) AS daily_videos,
    sum(f.total_views) AS total_views,
    sum(f.subscribers) AS subscribers,
    count(DISTINCT f.channel_id) AS channels_with_data,
    count(*) FILTER (WHERE f.daily_views_imputed) AS imputed_channels
   FROM fct_channel_daily f
     JOIN dim_channel c ON c.channel_id = f.channel_id
  WHERE c.is_active = false AND c.channel_type = 'owned'::text AND c.company IS NOT NULL
    AND NOT (EXISTS ( SELECT 1
           FROM fct_channel_daily f2
             JOIN dim_channel c2 ON c2.channel_id = f2.channel_id
          WHERE c2.company = c.company AND c2.is_active = true
            AND c2.channel_type = 'owned'::text AND f2.date = f.date))
  GROUP BY f.date, c.company;
