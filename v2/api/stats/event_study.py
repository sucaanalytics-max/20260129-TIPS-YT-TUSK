"""
/api/stats/event-study — market-model abnormal returns around catalyst events.

For each event in the last 365 days (releases, film_releases, earnings,
corporate actions) we:

  1. Pull a [-30, +30] trading-day window of TIPSMUSIC adjusted log-returns
     and NIFTY MIDCAP 150 log-returns around the event date.
  2. Estimate the market model α + β on the pre-event [-30, -6] estimation
     window via OLS.
  3. Compute AR_t = r_t - (α + β · r_m,t) for t ∈ [-5, +5].
  4. Aggregate across events of the same type: mean AR, mean CAR, bootstrapped
     95% CI (1000 resamples).
  5. Drop events that overlap another event of the same type within ±10 trading
     days (event-clustering contamination).

Writes fct_event_study keyed by (asof, event_type, day_offset).
"""
from __future__ import annotations

import os
import sys
import traceback
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    close_run,
    get_supabase,
    json_response,
    log_error,
    open_run,
    require_cron_auth,
)

PRE_WINDOW = (-30, -6)
EVENT_WINDOW = (-5, 5)
ANALYSIS_DAYS = 365
BOOTSTRAP_N = 1000


def handler(request: Any) -> Any:
    headers = _request_headers(request)
    ok, err = require_cron_auth(headers)
    if not ok:
        return json_response(401, {"ok": False, "error": err})

    sb = get_supabase()
    run_id = open_run(sb, "event_study")

    try:
        # Pull trading-day-aligned adjusted returns for TIPSMUSIC + NIFTY MIDCAP 150
        prices = _fetch_aligned_returns(sb, days=ANALYSIS_DAYS + 90)
        if prices.empty or len(prices) < 60:
            close_run(sb, run_id, "partial", rows_in=len(prices), rows_out=0, detail={"note": "insufficient price data"})
            return json_response(200, {"ok": True, "run_id": run_id, "note": "insufficient price data"})

        events = _fetch_events(sb, asof=date.today(), days=ANALYSIS_DAYS)
        if events.empty:
            close_run(sb, run_id, "ok", rows_in=0, rows_out=0, detail={"note": "no events"})
            return json_response(200, {"ok": True, "run_id": run_id, "note": "no events"})

        asof = date.today()
        rows: list[dict[str, Any]] = []
        per_type_dropped: dict[str, int] = {}

        for event_type, group in events.groupby("event_type"):
            kept, dropped = _filter_overlapping(group, window_days=10)
            per_type_dropped[event_type] = dropped

            ar_matrix = _build_ar_matrix(kept, prices)
            if ar_matrix is None or ar_matrix.shape[0] < 3:
                continue
            ar_mean = np.nanmean(ar_matrix, axis=0)
            car_mean = np.nancumsum(ar_mean)

            ci_lo_ar, ci_hi_ar = _bootstrap_ci(ar_matrix, BOOTSTRAP_N)
            ci_lo_car = np.cumsum(ci_lo_ar)
            ci_hi_car = np.cumsum(ci_hi_ar)

            for idx, day_offset in enumerate(range(EVENT_WINDOW[0], EVENT_WINDOW[1] + 1)):
                rows.append({
                    "asof": str(asof),
                    "event_type": event_type,
                    "day_offset": day_offset,
                    "mean_ar": float(ar_mean[idx]),
                    "mean_car": float(car_mean[idx]),
                    "ci_lo": float(ci_lo_car[idx]),
                    "ci_hi": float(ci_hi_car[idx]),
                    "n_obs": int(ar_matrix.shape[0]),
                    "n_dropped": int(dropped),
                    "ingest_run_id": run_id,
                })

        if rows:
            _chunked_upsert(sb, "fct_event_study", rows, on_conflict="asof,event_type,day_offset", chunk=200)

        close_run(
            sb,
            run_id,
            "ok",
            rows_in=len(events),
            rows_out=len(rows),
            detail={"asof": str(asof), "event_types": list(events["event_type"].unique()), "dropped": per_type_dropped},
        )
        _try_revalidate("events", "overview")
        return json_response(200, {"ok": True, "run_id": run_id, "rows": len(rows), "events": int(len(events))})

    except Exception as exc:  # noqa: BLE001
        log_error(sb, "event_study_failed", str(exc), ingest_run_id=run_id, detail={"stack": traceback.format_exc()})
        close_run(sb, run_id, "failed", detail={"error": str(exc)})
        return json_response(500, {"ok": False, "error": str(exc)})


def _fetch_aligned_returns(sb: Any, days: int) -> pd.DataFrame:
    """TIPSMUSIC adjusted log-return + NIFTY MIDCAP 150 log-return aligned by date."""
    price_res = (
        sb.table("fct_adjusted_price_daily")
        .select("date, adjusted_close")
        .eq("symbol", "TIPSMUSIC")
        .order("date", desc=False)
        .execute()
    )
    idx_res = (
        sb.table("dim_market_index")
        .select("date, close")
        .eq("index_name", "NIFTY_MIDCAP_150")
        .order("date", desc=False)
        .execute()
    )
    p = pd.DataFrame(price_res.data or [])
    m = pd.DataFrame(idx_res.data or [])
    if p.empty or m.empty:
        return pd.DataFrame()
    p["date"] = pd.to_datetime(p["date"]).dt.date
    m["date"] = pd.to_datetime(m["date"]).dt.date
    p["adjusted_close"] = pd.to_numeric(p["adjusted_close"], errors="coerce")
    m["close"] = pd.to_numeric(m["close"], errors="coerce")
    p["r_i"] = np.log(p["adjusted_close"]) - np.log(p["adjusted_close"].shift(1))
    m["r_m"] = np.log(m["close"]) - np.log(m["close"].shift(1))
    out = p[["date", "r_i"]].merge(m[["date", "r_m"]], on="date", how="inner").dropna()
    out = out.tail(days).reset_index(drop=True)
    return out


def _fetch_events(sb: Any, asof: date, days: int) -> pd.DataFrame:
    since = (asof - timedelta(days=days)).isoformat()
    until = asof.isoformat()
    res = (
        sb.table("dim_event")
        .select("event_id, event_type, event_date, channel_id, video_id, company")
        .gte("event_date", since)
        .lte("event_date", until)
        .execute()
    )
    df = pd.DataFrame(res.data or [])
    if df.empty:
        return df
    df["event_date"] = pd.to_datetime(df["event_date"]).dt.date
    df = df[df["event_type"].isin(["release", "earnings", "split", "bonus", "dividend"])]
    return df.reset_index(drop=True)


def _filter_overlapping(events: pd.DataFrame, window_days: int) -> tuple[pd.DataFrame, int]:
    """Drop events that have another event of the same type within ±window_days
    trading days (proxied by calendar days here — close enough for music release
    cadence). Returns (kept, dropped_count)."""
    sorted_e = events.sort_values("event_date").reset_index(drop=True)
    keep_mask = np.ones(len(sorted_e), dtype=bool)
    dates = sorted_e["event_date"].values
    for i, d in enumerate(dates):
        if not keep_mask[i]:
            continue
        for j in range(i + 1, len(dates)):
            delta = (dates[j] - d).days
            if delta > window_days:
                break
            keep_mask[j] = False
    kept = sorted_e[keep_mask].reset_index(drop=True)
    return kept, int(len(events) - len(kept))


def _build_ar_matrix(events: pd.DataFrame, prices: pd.DataFrame) -> np.ndarray | None:
    """Return matrix shape (n_events, event_window_len) of abnormal returns.

    For each event:
      - find the index in `prices` of the trading day on/after event_date
      - estimate market model α + β on pre-event [-30, -6] window via OLS
      - compute AR over event window [-5, +5]
    Events without enough surrounding history are skipped.
    """
    if prices.empty:
        return None
    trading_dates = prices["date"].tolist()
    date_to_idx = {d: i for i, d in enumerate(trading_dates)}
    window_len = EVENT_WINDOW[1] - EVENT_WINDOW[0] + 1
    ar_rows: list[np.ndarray] = []

    for _, ev in events.iterrows():
        ev_date = ev["event_date"]
        # Snap to next trading day on/after event_date (handles weekends).
        idx = next((i for i, d in enumerate(trading_dates) if d >= ev_date), None)
        if idx is None:
            continue
        est_lo = idx + PRE_WINDOW[0]
        est_hi = idx + PRE_WINDOW[1]
        evt_lo = idx + EVENT_WINDOW[0]
        evt_hi = idx + EVENT_WINDOW[1]
        if est_lo < 0 or evt_hi >= len(prices):
            continue

        est = prices.iloc[est_lo : est_hi + 1]
        evt = prices.iloc[evt_lo : evt_hi + 1]
        if len(est) < 10 or len(evt) != window_len:
            continue

        # OLS market model: r_i = α + β · r_m + ε
        x = est["r_m"].values
        y = est["r_i"].values
        x_mean = x.mean()
        y_mean = y.mean()
        denom = ((x - x_mean) ** 2).sum()
        if denom == 0:
            continue
        beta = ((x - x_mean) * (y - y_mean)).sum() / denom
        alpha = y_mean - beta * x_mean
        ar = evt["r_i"].values - (alpha + beta * evt["r_m"].values)
        ar_rows.append(ar)

    if not ar_rows:
        return None
    return np.vstack(ar_rows)


def _bootstrap_ci(ar_matrix: np.ndarray, n_boot: int) -> tuple[np.ndarray, np.ndarray]:
    n_events = ar_matrix.shape[0]
    rng = np.random.default_rng(seed=42)
    means = np.empty((n_boot, ar_matrix.shape[1]))
    for b in range(n_boot):
        sample = rng.integers(0, n_events, n_events)
        means[b] = np.nanmean(ar_matrix[sample], axis=0)
    lo = np.nanpercentile(means, 2.5, axis=0)
    hi = np.nanpercentile(means, 97.5, axis=0)
    return lo, hi


def _chunked_upsert(sb: Any, table: str, rows: list[dict[str, Any]], on_conflict: str, chunk: int) -> None:
    for i in range(0, len(rows), chunk):
        sb.table(table).upsert(rows[i : i + chunk], on_conflict=on_conflict).execute()


def _try_revalidate(*tags: str) -> None:
    import urllib.request
    import urllib.error

    url = os.environ.get("NEXT_PUBLIC_APP_URL")
    secret = os.environ.get("CRON_SECRET")
    if not url or not secret:
        return
    body = ('{"tags": [' + ",".join(f'"{t}"' for t in tags) + "]}").encode("utf-8")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/api/internal/revalidate",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as _:
            pass
    except urllib.error.URLError as exc:
        print(f"revalidate webhook failed: {exc}", flush=True)


def _request_headers(request: Any) -> dict[str, str]:
    if hasattr(request, "headers"):
        return {str(k): str(v) for k, v in request.headers.items()}
    if isinstance(request, dict) and "headers" in request:
        return {str(k): str(v) for k, v in request["headers"].items()}
    return {}


from http.server import BaseHTTPRequestHandler  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        return self._dispatch()

    def do_POST(self):  # noqa: N802
        return self._dispatch()

    def _dispatch(self):
        headers = {k.lower(): v for k, v in self.headers.items()}
        status, hdrs, body = handler(type("Req", (), {"headers": headers})())
        self.send_response(status)
        for k, v in hdrs.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))
