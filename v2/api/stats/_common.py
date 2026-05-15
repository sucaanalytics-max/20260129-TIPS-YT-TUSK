"""
Shared helpers for the Python stats service.

The two route handlers (recompute, event_study) share:
  - auth (Bearer CRON_SECRET)
  - Supabase service-role client
  - ops_ingest_run open/close + ops_error_log writes
  - JSON response shape

These are imported by sibling modules in the same Vercel function dir.
"""
from __future__ import annotations

import json
import os
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from supabase import Client, create_client


def get_supabase() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def require_cron_auth(headers: dict[str, str]) -> tuple[bool, str | None]:
    """Mirror of v2/lib/cron-auth.ts. Returns (ok, error_message)."""
    secret = os.environ.get("CRON_SECRET", "")
    if not secret:
        return False, "CRON_SECRET not configured"
    auth = headers.get("authorization") or headers.get("Authorization") or ""
    token = auth.replace("Bearer ", "", 1).strip()
    if token != secret:
        return False, "Unauthorized"
    return True, None


def open_run(sb: Client, source: str) -> int:
    """Insert ops_ingest_run row, return run_id."""
    res = sb.table("ops_ingest_run").insert({"source": source, "status": "running"}).execute()
    rows = res.data or []
    if not rows:
        raise RuntimeError(f"open_run({source}): no row returned")
    return rows[0]["run_id"]


def close_run(
    sb: Client,
    run_id: int,
    status: str,
    rows_in: int | None = None,
    rows_out: int | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    sb.table("ops_ingest_run").update(
        {
            "status": status,
            "ended_at": datetime.now(timezone.utc).isoformat(),
            "rows_in": rows_in,
            "rows_out": rows_out,
            "detail": detail,
        }
    ).eq("run_id", run_id).execute()


def log_error(
    sb: Client,
    error_type: str,
    error_message: str,
    ingest_run_id: int | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    try:
        sb.table("ops_error_log").insert(
            {
                "error_type": error_type,
                "error_message": error_message[:5000],
                "ingest_run_id": ingest_run_id,
                "detail": detail,
            }
        ).execute()
    except Exception as exc:  # last-resort: stdout
        print(f"ops_error_log write failed: {exc}", flush=True)


@contextmanager
def run_context(sb: Client, source: str) -> Iterator[int]:
    """Context manager: opens a run row, marks failed on uncaught exception."""
    run_id = open_run(sb, source)
    try:
        yield run_id
    except Exception as exc:
        log_error(
            sb,
            error_type=f"{source}_failed",
            error_message=str(exc),
            ingest_run_id=run_id,
            detail={"stack": traceback.format_exc()},
        )
        close_run(sb, run_id, "failed", detail={"error": str(exc)})
        raise


def json_response(status: int, body: dict[str, Any]) -> tuple[int, dict[str, str], str]:
    return status, {"Content-Type": "application/json"}, json.dumps(body, default=str)
