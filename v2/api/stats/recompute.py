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


def handler(request: Any) -> Any:
    """Vercel Python handler. Returns (status, headers, body)."""
    headers = _request_headers(request)
    ok, err = require_cron_auth(headers)
    if not ok:
        return json_response(401, {"ok": False, "error": err})

    sb = get_supabase()
    run_id = open_run(sb, "stats_recompute")

    try:
        # 1) Refresh the materialized view so we read a stable snapshot.
        sb.rpc("refresh_fct_returns_daily").execute() if _rpc_exists(sb) else _manual_refresh(sb)

        # 2) Pull last 730 days
        df = _fetch_returns(sb, days=730)
        if df.empty or len(df) < 30:
            close_run(sb, run_id, "partial", rows_in=len(df), rows_out=0, detail={"note": "insufficient data"})
            return json_response(200, {"ok": True, "run_id": run_id, "rows": len(df), "note": "insufficient data"})

        # 3) ADF stationarity diagnostics
        adf = {
            "log_return":       _adf_summary(df["log_return"].dropna()),
            "log_growth_views": _adf_summary(df["log_growth_views"].dropna()),
        }

        # 4) Rolling correlation grid
        corr_rows, raw_pvals = _compute_correlation_grid(df, asof=df["date"].max())
        if raw_pvals:
            _, p_fdr, _, _ = multipletests(raw_pvals, method="fdr_bh")
            for row, p_adj in zip(corr_rows, p_fdr):
                row["p_value_fdr"] = float(p_adj)
                row["is_significant"] = bool(p_adj < 0.05 and row["n_obs"] >= max(10, row["window_days"] // 2))
                row["ingest_run_id"] = run_id

        if corr_rows:
            _chunked_upsert(sb, "fct_correlation_window", corr_rows, on_conflict="asof,window_days,lag_days", chunk=200)

        # 5) Granger causality
        granger_rows = _compute_granger(df, asof=df["date"].max(), max_lag=10, run_id=run_id)
        if granger_rows:
            _chunked_upsert(sb, "fct_granger_summary", granger_rows, on_conflict="asof,direction,lag", chunk=100)

        close_run(
            sb,
            run_id,
            "ok",
            rows_in=len(df),
            rows_out=len(corr_rows) + len(granger_rows),
            detail={"adf": adf, "windows": list(WINDOWS), "lags": list(LAGS), "asof": str(df["date"].max())},
        )

        # Cache invalidation handled by the Next.js side via a webhook to
        # /api/internal/revalidate (POST { tag: 'correlation' }). Implemented
        # only if NEXT_PUBLIC_APP_URL + an internal secret are set.
        _try_revalidate("correlation", "events", "overview", "signals")

        return json_response(
            200,
            {"ok": True, "run_id": run_id, "rows": len(df), "correlation_rows": len(corr_rows), "granger_rows": len(granger_rows)},
        )

    except Exception as exc:  # noqa: BLE001
        import traceback
        log_error(sb, "stats_recompute_failed", str(exc), ingest_run_id=run_id, detail={"stack": traceback.format_exc()})
        close_run(sb, run_id, "failed", detail={"error": str(exc)})
        return json_response(500, {"ok": False, "error": str(exc)})


# ---- Internals --------------------------------------------------------------

def _rpc_exists(sb: Any) -> bool:
    # Reserved for if/when we add a refresh_fct_returns_daily RPC. For now
    # we fall back to a raw REFRESH MATERIALIZED VIEW via execute().
    return False


def _manual_refresh(sb: Any) -> None:
    # Supabase-py doesn't expose raw SQL; rely on a SECURITY DEFINER function.
    # We provision this in migration 0006 (see below) named refresh_fct_returns.
    try:
        sb.rpc("refresh_fct_returns").execute()
    except Exception as exc:  # noqa: BLE001
        # MV may not exist yet (fresh project, no data). Continue without refresh.
        print(f"refresh_fct_returns failed (continuing): {exc}", flush=True)


def _fetch_returns(sb: Any, days: int) -> pd.DataFrame:
    res = (
        sb.table("fct_returns_daily")
        .select("date, close, log_return, daily_views, log_growth_views, index_close, log_return_mkt")
        .order("date", desc=False)
        .limit(days)
        .execute()
    )
    df = pd.DataFrame(res.data or [])
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"]).dt.date
    for col in ("log_return", "log_growth_views", "log_return_mkt"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.dropna(subset=["log_return", "log_growth_views"]).reset_index(drop=True)


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
