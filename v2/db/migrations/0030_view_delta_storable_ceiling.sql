-- Sync repair_view_deltas() with lib/view-delta.ts's storable ceiling.
--
-- 0026 shipped this function as a statement-for-statement mirror of
-- lib/view-delta.ts, and it faithfully mirrored a defect. The branch that keeps
-- a catch-up delta WHOLE writes the per-day rate times the span, so any span of
-- three or more days can pass the 200m/day plausibility test and still exceed
-- the absolute CHECK constraint of 500m. 0026's own comment claimed the rate
-- ceiling kept every repair storable; it does not.
--
-- On the TypeScript side that took the channel ingest down from 2026-08-28:
-- 71 rows offered, 0 written, every run, and because each failed day widened
-- the gap the next span was longer than the last -- a failure that could not
-- recover on its own. The function has the same hole; it had simply not been
-- run against a wide enough gap to hit it.
--
-- Values at or above the ceiling are now left UNKNOWN rather than written. An
-- unknown day costs one day of reach. A rejected row costs the whole batch.

CREATE OR REPLACE FUNCTION repair_view_deltas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  max_plausible constant bigint := 200000000;  -- = MAX_PLAUSIBLE_DAILY_VIEWS
  max_storable  constant bigint := 500000000;  -- = fct_channel_daily_daily_views_check
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
            --
            -- ...but only if the row can actually be stored. This is the one
            -- branch that writes more than a single day's rate, so it is the
            -- one branch that can clear the CHECK constraint while passing the
            -- per-day plausibility test. Mirrors MAX_STORABLE_DAILY_VIEWS in
            -- lib/view-delta.ts; the two must not drift.
            IF dv >= max_storable THEN
              UPDATE fct_channel_daily
                 SET daily_views = NULL, daily_views_imputed = false, delta_span_days = NULL
               WHERE channel_id = ch.cid AND date = r.d;
            ELSE
              UPDATE fct_channel_daily
                 SET daily_views = dv, daily_views_imputed = false, delta_span_days = span
               WHERE channel_id = ch.cid AND date = r.d;
            END IF;
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
