"""
/api/stats/recompute — research-grade time-series correlation pipeline.

Pulls fct_returns_daily (TIPSMUSIC log-returns × company-rollup log-growth-views,
inner-joined on trading dates only), refreshes the MV, then writes three things:

  fct_correlation_window   rolling Pearson/Spearman at lags -10..+10 for windows
                           {7, 30, 60, 120} days; raw p-values + Benjamini-
                           Hochberg FDR-adjusted p-values across (window × lag).
  fct_granger_summary      F-statistic + p-value for views→returns and
                           returns→views at lags 1..10.
  ops_ingest_run.detail    ADF stationarity test results for both series.

UI never invokes this directly — reads the pre-computed tables.
"""
from __future__ import annotations

import os
import sys
from datetime import date
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats as scistats
from statsmodels.stats.multitest import multipletests
from statsmodels.tsa.stattools import adfuller, grangercausalitytests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (  # noqa: E402
    close_run,
    get_supabase,
    json_response,
    log_error,
    open_run,
    require_cron_auth,
)

WINDOWS = (7, 30, 60, 120)
LAGS = tuple(range(-10, 11))
SYMBOLS = ("TIPSMUSIC", "SAREGAMA")


def handler(request: Any) -> Any:
    """Vercel Python handler. Returns (status, headers, body)."""
    headers = _request_headers(request)
    ok, err = require_cron_auth(headers)
    if not ok:
        return json_response(401, {"ok": False, "error": err})

    sb = get_supabase()
    run_id = open_run(sb, "stats_recompute")

    try:
        per_symbol_summary: dict[str, Any] = {}
        total_corr_rows = 0
        total_granger_rows = 0

        for symbol in SYMBOLS:
            df = _fetch_returns_for_symbol(sb, symbol=symbol, days=730)
            if df.empty or len(df) < 30:
                per_symbol_summary[symbol] = {"rows": len(df), "note": "insufficient data"}
                continue

            asof = df["date"].max()
            adf = {
                "log_return":       _adf_summary(df["log_return"].dropna()),
                "log_growth_views": _adf_summary(df["log_growth_views"].dropna()),
            }

            corr_rows, raw_pvals = _compute_correlation_grid(df, asof=asof)
            if raw_pvals:
                _, p_fdr, _, _ = multipletests(raw_pvals, method="fdr_bh")
                for row, p_adj in zip(corr_rows, p_fdr):
                    row["symbol"] = symbol
                    row["p_value_fdr"] = float(p_adj)
                    row["is_significant"] = bool(p_adj < 0.05 and row["n_obs"] >= max(10, row["window_days"] // 2))
                    row["ingest_run_id"] = run_id

            if corr_rows:
                _chunked_upsert(sb, "fct_correlation_window", corr_rows, on_conflict="symbol,asof,window_days,lag_days", chunk=200)
                total_corr_rows += len(corr_rows)

            granger_rows = _compute_granger(df, asof=asof, max_lag=10, run_id=run_id)
            for row in granger_rows:
                row["symbol"] = symbol
            if granger_rows:
                _chunked_upsert(sb, "fct_granger_summary", granger_rows, on_conflict="symbol,asof,direction,lag", chunk=100)
                total_granger_rows += len(granger_rows)

            per_symbol_summary[symbol] = {
                "rows": len(df),
                "asof": str(asof),
                "correlation_rows": len(corr_rows),
                "granger_rows": len(granger_rows),
                "adf": adf,
            }

        close_run(
            sb,
            run_id,
            "ok" if any("correlation_rows" in v for v in per_symbol_summary.values()) else "partial",
            rows_in=sum(v.get("rows", 0) for v in per_symbol_summary.values()),
            rows_out=total_corr_rows + total_granger_rows,
            detail={"per_symbol": per_symbol_summary, "windows": list(WINDOWS), "lags": list(LAGS)},
        )

        _try_revalidate("correlation", "events", "overview", "signals")

        return json_response(
            200,
            {
                "ok": True,
                "run_id": run_id,
                "per_symbol": per_symbol_summary,
                "correlation_rows": total_corr_rows,
                "granger_rows": total_granger_rows,
            },
        )

    except Exception as exc:  # noqa: BLE001
        import traceback
        log_error(sb, "stats_recompute_failed", str(exc), ingest_run_id=run_id, detail={"stack": traceback.format_exc()})
        close_run(sb, run_id, "failed", detail={"error": str(exc)})
        return json_response(500, {"ok": False, "error": str(exc)})


# ---- Internals --------------------------------------------------------------

def _fetch_returns_for_symbol(sb: Any, symbol: str, days: int) -> pd.DataFrame:
    """Pull (date, price, views) per symbol from base tables and compute
    log-return + log-growth-views in pandas. Replaces the original MV path
    which was TIPSMUSIC-hardcoded — and which also silently broke once total
    rows exceeded the implicit `.limit(days)` (got first N dates, not last).

    Use a date floor instead of limit ordering so the row-window is correct
    regardless of how much history accumulates.

    Joins on trading dates only (inner join price ⋈ views) — non-trading
    days don't get a log_return so excluding them is the right move.
    """
    from datetime import date as _date, timedelta as _td
    # Calendar days × 1.6 ~ trading days × 1 with weekends + holiday buffer.
    floor = (_date.today() - _td(days=int(days * 1.6))).isoformat()
    # Price series (adjusted close, trading days only).
    # Explicit .limit(5000) overrides PostgREST's default 1000-row cap —
    # views series has ~365 rows/year so the cap would silently truncate
    # the tail of the window and skew asof.
    res_price = (
        sb.table("fct_adjusted_price_daily")
        .select("date, adjusted_close")
        .eq("symbol", symbol)
        .gte("date", floor)
        .order("date", desc=False)
        .limit(5000)
        .execute()
    )
    price_df = pd.DataFrame(res_price.data or [])
    if price_df.empty:
        return pd.DataFrame()
    price_df["date"] = pd.to_datetime(price_df["date"]).dt.date
    price_df["adjusted_close"] = pd.to_numeric(price_df["adjusted_close"], errors="coerce")
    price_df = price_df.dropna().sort_values("date").reset_index(drop=True)
    price_df["log_return"] = np.log(price_df["adjusted_close"]) - np.log(price_df["adjusted_close"].shift(1))

    # Views series (v_company_daily — already SUM'd across owned channels).
    # .limit(5000) defeats PostgREST's 1000-row cap (v_company_daily ~365/year).
    res_views = (
        sb.table("v_company_daily")
        .select("date, daily_views")
        .eq("company", symbol)
        .gte("date", floor)
        .order("date", desc=False)
        .limit(5000)
        .execute()
    )
    views_df = pd.DataFrame(res_views.data or [])
    if views_df.empty:
        return pd.DataFrame()
    views_df["date"] = pd.to_datetime(views_df["date"]).dt.date
    views_df["daily_views"] = pd.to_numeric(views_df["daily_views"], errors="coerce")
    views_df = views_df.dropna().sort_values("date").reset_index(drop=True)
    # Log-growth of views: treat zero/missing as missing, lag by 1
    views_df["log_growth_views"] = np.log(views_df["daily_views"].replace(0, np.nan)) - np.log(
        views_df["daily_views"].shift(1).replace(0, np.nan)
    )

    # Inner join on trading dates only (non-trading dates have no price → dropped)
    df = price_df.merge(
        views_df[["date", "daily_views", "log_growth_views"]],
        on="date",
        how="inner",
    )
    df = df.rename(columns={"adjusted_close": "close"})

    # Drop the first row (NaN log_return / log_growth_views from the shift)
    df = df.dropna(subset=["log_return", "log_growth_views"]).reset_index(drop=True)

    # Trim to last `days` trading days
    return df.tail(days).reset_index(drop=True)


def _adf_summary(series: pd.Series) -> dict[str, Any]:
    if len(series) < 20:
        return {"n": len(series), "note": "insufficient"}
    stat, pvalue, _, _, crit, _ = adfuller(series, autolag="AIC")
    return {
        "n": int(len(series)),
        "adf_stat": float(stat),
        "p_value": float(pvalue),
        "critical_1pct": float(crit["1%"]),
        "critical_5pct": float(crit["5%"]),
        "stationary_at_5pct": bool(pvalue < 0.05),
    }


def _compute_correlation_grid(df: pd.DataFrame, asof: date) -> tuple[list[dict[str, Any]], list[float]]:
    """For each (window, lag) compute Pearson r + Spearman ρ on the trailing window.

    Lag convention: positive k means views_t correlated with returns_{t+k}
    (views lead returns by k trading days). Negative k = returns lead views.
    """
    out: list[dict[str, Any]] = []
    raw_pvals: list[float] = []
    returns = df["log_return"].values
    views = df["log_growth_views"].values
    n = len(df)

    for window in WINDOWS:
        if n < window + max(abs(min(LAGS)), abs(max(LAGS))):
            continue
        for lag in LAGS:
            x, y = _aligned_pair(views, returns, lag)
            x = x[-window:]
            y = y[-window:]
            valid = ~(np.isnan(x) | np.isnan(y))
            x, y = x[valid], y[valid]
            if len(x) < 5:
                continue
            r_p, p_p = scistats.pearsonr(x, y)
            r_s, p_s = scistats.spearmanr(x, y)
            row = {
                "asof": str(asof),
                "window_days": window,
                "lag_days": lag,
                "pearson_r": float(r_p),
                "spearman_rho": float(r_s),
                "n_obs": int(len(x)),
                "p_value_raw": float(p_p),
                # filled in after FDR adjustment in the caller
            }
            out.append(row)
            raw_pvals.append(float(p_p))
    return out, raw_pvals


def _aligned_pair(x: np.ndarray, y: np.ndarray, lag: int) -> tuple[np.ndarray, np.ndarray]:
    """Shift x by `lag` positions relative to y. Positive lag: x leads y."""
    if lag == 0:
        return x, y
    if lag > 0:
        return x[:-lag], y[lag:]
    return x[-lag:], y[:lag]


def _compute_granger(df: pd.DataFrame, asof: date, max_lag: int, run_id: int) -> list[dict[str, Any]]:
    if len(df) < max_lag + 30:
        return []
    pair_v2r = df[["log_return", "log_growth_views"]].dropna()  # tests views → returns
    pair_r2v = df[["log_growth_views", "log_return"]].dropna()  # tests returns → views
    out: list[dict[str, Any]] = []
    for direction, frame in (("views_to_returns", pair_v2r), ("returns_to_views", pair_r2v)):
        try:
            res = grangercausalitytests(frame.values, maxlag=max_lag, verbose=False)
            for lag in range(1, max_lag + 1):
                f_stat, p_val, _, _ = res[lag][0]["ssr_ftest"]
                out.append({
                    "asof": str(asof),
                    "direction": direction,
                    "lag": lag,
                    "f_statistic": float(f_stat),
                    "p_value": float(p_val),
                    "n_obs": int(len(frame) - lag),
                    "ingest_run_id": run_id,
                })
        except Exception as exc:  # noqa: BLE001
            print(f"granger {direction} failed: {exc}", flush=True)
    return out


def _chunked_upsert(sb: Any, table: str, rows: list[dict[str, Any]], on_conflict: str, chunk: int) -> None:
    for i in range(0, len(rows), chunk):
        sb.table(table).upsert(rows[i : i + chunk], on_conflict=on_conflict).execute()


def _try_revalidate(*tags: str) -> None:
    """Best-effort: POST to /api/internal/revalidate so Next.js cache tags
    refresh as soon as new stats land. No-op if env not set."""
    import urllib.request
    import urllib.error

    url = os.environ.get("NEXT_PUBLIC_APP_URL")
    secret = os.environ.get("CRON_SECRET")
    if not url or not secret:
        return
    body = (
        '{"tags": [' + ",".join(f'"{t}"' for t in tags) + "]}"
    ).encode("utf-8")
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
    # Vercel python runtime exposes either WSGI-style env or a `headers` attr;
    # handle both shapes.
    if hasattr(request, "headers"):
        return {str(k): str(v) for k, v in request.headers.items()}
    if isinstance(request, dict) and "headers" in request:
        return {str(k): str(v) for k, v in request["headers"].items()}
    return {}


# Vercel BaseHTTPRequestHandler entrypoint
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
