"""
SQLite persistence. Jobs accumulate across searches (deduplicated by job URL)
and keep the user's triage status/notes. Raw scraped fields and derived
analysis are stored as JSON blobs; filtering happens in the browser.
"""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import threading
from datetime import date, datetime, timedelta

from webapp.analysis import analyze
from webapp.profile import DATA_DIR

DB_PATH = DATA_DIR / "jobs.db"
STATUSES = ("new", "saved", "applied", "interview", "offer", "rejected", "discarded", "archived")
# Columns added after the first release; created on startup when missing.
_MIGRATIONS = {"seen_at": "TEXT", "applied_at": "TEXT", "followup_at": "TEXT"}

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                analysis TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                notes TEXT NOT NULL DEFAULT '',
                region_hint TEXT,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                run_ids TEXT NOT NULL DEFAULT '[]',
                template_ids TEXT NOT NULL DEFAULT '[]',
                status_changed TEXT
            );
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                finished_at TEXT,
                label TEXT,
                template_id TEXT,
                params TEXT NOT NULL,
                status TEXT NOT NULL,
                sites TEXT NOT NULL DEFAULT '{}',
                total INTEGER NOT NULL DEFAULT 0,
                new_count INTEGER NOT NULL DEFAULT 0,
                log TEXT NOT NULL DEFAULT ''
            );
            """
        )
        cols = {r["name"] for r in _conn.execute("PRAGMA table_info(jobs)")}
        for col, typ in _MIGRATIONS.items():
            if col not in cols:
                _conn.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")
        _conn.commit()
    return _conn


def _clean(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if hasattr(value, "item"):  # numpy scalars
        return _clean(value.item())
    return value


def job_id(job: dict) -> str:
    key = job.get("job_url") or job.get("job_url_direct")
    if not key:
        key = f"{job.get('site')}|{job.get('title')}|{job.get('company')}|{job.get('location')}"
    return hashlib.sha1(str(key).rstrip("/").encode()).hexdigest()[:16]


def upsert_jobs(records: list[dict], profile: dict, run_id: int | None,
                template_id: str | None, region_hint: str | None) -> tuple[int, int]:
    """Returns (total, new)."""
    now = datetime.now().isoformat(timespec="seconds")
    new = 0
    with _lock:
        c = conn()
        for raw in records:
            job = {k: _clean(v) for k, v in raw.items()}
            if not job.get("title"):
                continue
            jid = job_id(job)
            row = c.execute("SELECT * FROM jobs WHERE id = ?", (jid,)).fetchone()
            if row:
                old = json.loads(row["data"])
                # keep older non-empty values (e.g. a description fetched earlier)
                merged = {**old, **{k: v for k, v in job.items() if v not in (None, "")}}
                runs = json.loads(row["run_ids"])
                tpls = json.loads(row["template_ids"])
                if run_id and run_id not in runs:
                    runs.append(run_id)
                if template_id and template_id not in tpls:
                    tpls.append(template_id)
                hint = row["region_hint"] or region_hint
                c.execute(
                    # an archived job showing up again is still open: bring it back
                    "UPDATE jobs SET data=?, analysis=?, last_seen=?, run_ids=?, template_ids=?, region_hint=?, "
                    "status=CASE status WHEN 'archived' THEN 'new' ELSE status END WHERE id=?",
                    (
                        json.dumps(merged, ensure_ascii=False),
                        json.dumps(analyze(merged, profile, hint)),
                        now,
                        json.dumps(runs),
                        json.dumps(tpls),
                        hint,
                        jid,
                    ),
                )
            else:
                new += 1
                c.execute(
                    "INSERT INTO jobs (id, data, analysis, region_hint, first_seen, last_seen, run_ids, template_ids) VALUES (?,?,?,?,?,?,?,?)",
                    (
                        jid,
                        json.dumps(job, ensure_ascii=False),
                        json.dumps(analyze(job, profile, region_hint)),
                        region_hint,
                        now,
                        now,
                        json.dumps([run_id] if run_id else []),
                        json.dumps([template_id] if template_id else []),
                    ),
                )
        c.commit()
    return len(records), new


def list_jobs() -> list[dict]:
    with _lock:
        rows = conn().execute("SELECT * FROM jobs").fetchall()
    out = []
    for r in rows:
        job = json.loads(r["data"])
        job.update(json.loads(r["analysis"]))
        job.update(
            id=r["id"],
            status=r["status"],
            notes=r["notes"],
            first_seen=r["first_seen"],
            last_seen=r["last_seen"],
            run_ids=json.loads(r["run_ids"]),
            template_ids=json.loads(r["template_ids"]),
            status_changed=r["status_changed"],
            seen_at=r["seen_at"],
            applied_at=r["applied_at"],
            followup_at=r["followup_at"],
        )
        out.append(job)
    return out


def update_jobs(ids: list[str], status: str | None = None, notes: str | None = None,
                seen: bool = False, followup: bool = False) -> int:
    now = datetime.now().isoformat(timespec="seconds")
    with _lock:
        c = conn()
        n = 0
        for jid in ids:
            if status is not None:
                n += c.execute(
                    "UPDATE jobs SET status=?, status_changed=? WHERE id=?", (status, now, jid)
                ).rowcount
                if status == "applied":
                    c.execute("UPDATE jobs SET applied_at=? WHERE id=? AND applied_at IS NULL", (now, jid))
            if notes is not None:
                n += c.execute("UPDATE jobs SET notes=? WHERE id=?", (notes, jid)).rowcount
            if seen:
                n += c.execute("UPDATE jobs SET seen_at=? WHERE id=? AND seen_at IS NULL", (now, jid)).rowcount
            if followup:
                n += c.execute("UPDATE jobs SET followup_at=? WHERE id=?", (now, jid)).rowcount
        c.commit()
    return n


def delete_jobs(status: str | None = None, ids: list[str] | None = None) -> int:
    with _lock:
        c = conn()
        if ids:
            n = sum(c.execute("DELETE FROM jobs WHERE id=?", (i,)).rowcount for i in ids)
        elif status:
            n = c.execute("DELETE FROM jobs WHERE status=?", (status,)).rowcount
        else:
            n = c.execute("DELETE FROM jobs").rowcount
        c.commit()
    return n


def archive_stale(days: int, dry_run: bool = False) -> int:
    """Untriaged jobs that no search has returned in `days` days probably closed."""
    cutoff = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
    now = datetime.now().isoformat(timespec="seconds")
    with _lock:
        c = conn()
        if dry_run:
            return c.execute("SELECT COUNT(*) FROM jobs WHERE status='new' AND last_seen < ?", (cutoff,)).fetchone()[0]
        n = c.execute(
            "UPDATE jobs SET status='archived', status_changed=? WHERE status='new' AND last_seen < ?", (now, cutoff)
        ).rowcount
        c.commit()
    return n


def old_run_ids(days: int) -> list[int]:
    cutoff = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
    with _lock:
        rows = conn().execute(
            "SELECT id FROM runs WHERE created_at < ? AND status NOT IN ('queued','running')", (cutoff,)
        ).fetchall()
    return [r["id"] for r in rows]


def reanalyze_all(profile: dict) -> int:
    with _lock:
        c = conn()
        rows = c.execute("SELECT id, data, region_hint FROM jobs").fetchall()
        for r in rows:
            analysis = analyze(json.loads(r["data"]), profile, r["region_hint"])
            c.execute("UPDATE jobs SET analysis=? WHERE id=?", (json.dumps(analysis), r["id"]))
        c.commit()
    return len(rows)


# ------------------------------------------------------------------ runs

def create_run(label: str, template_id: str | None, params: dict) -> int:
    with _lock:
        c = conn()
        cur = c.execute(
            "INSERT INTO runs (created_at, label, template_id, params, status) VALUES (?,?,?,?,?)",
            (datetime.now().isoformat(timespec="seconds"), label, template_id,
             json.dumps(params, ensure_ascii=False), "queued"),
        )
        c.commit()
        return cur.lastrowid


def update_run(run_id: int, **fields) -> None:
    if not fields:
        return
    for k in ("sites", "params"):
        if k in fields and not isinstance(fields[k], str):
            fields[k] = json.dumps(fields[k], ensure_ascii=False)
    cols = ", ".join(f"{k}=?" for k in fields)
    with _lock:
        c = conn()
        c.execute(f"UPDATE runs SET {cols} WHERE id=?", (*fields.values(), run_id))
        c.commit()


def append_run_log(run_id: int, line: str) -> None:
    with _lock:
        c = conn()
        c.execute("UPDATE runs SET log = log || ? WHERE id=?", (line + "\n", run_id))
        c.commit()


def _run_dict(r: sqlite3.Row, full_log: bool) -> dict:
    d = dict(r)
    d["params"] = json.loads(d["params"])
    d["sites"] = json.loads(d["sites"])
    if not full_log:
        d["log"] = "\n".join(d["log"].splitlines()[-8:])
    return d


def list_runs(limit: int = 100) -> list[dict]:
    with _lock:
        rows = conn().execute("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_run_dict(r, False) for r in rows]


def get_run(run_id: int) -> dict | None:
    with _lock:
        r = conn().execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    return _run_dict(r, True) if r else None


def delete_runs(run_ids: list[int], delete_jobs: bool) -> dict:
    """
    Removes runs from history and unlinks them from their jobs. With delete_jobs,
    also deletes jobs no other run found that are still untriaged ('new');
    saved/applied/interview/discarded jobs are always kept.
    """
    jobs_deleted = 0
    with _lock:
        c = conn()
        targets = set(run_ids)
        for row in c.execute("SELECT id, run_ids, status FROM jobs").fetchall():
            runs = json.loads(row["run_ids"])
            if not targets.intersection(runs):
                continue
            remaining = [r for r in runs if r not in targets]
            if delete_jobs and not remaining and row["status"] == "new":
                c.execute("DELETE FROM jobs WHERE id=?", (row["id"],))
                jobs_deleted += 1
            else:
                c.execute("UPDATE jobs SET run_ids=? WHERE id=?", (json.dumps(remaining), row["id"]))
        runs_deleted = sum(c.execute("DELETE FROM runs WHERE id=?", (r,)).rowcount for r in targets)
        c.commit()
    return {"runs_deleted": runs_deleted, "jobs_deleted": jobs_deleted}


def mark_interrupted_runs() -> None:
    with _lock:
        c = conn()
        c.execute("UPDATE runs SET status='interrupted' WHERE status IN ('queued','running')")
        c.commit()
