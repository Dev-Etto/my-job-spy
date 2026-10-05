"""
Background search queue.

Runs are processed one at a time (being gentle with LinkedIn rate limits and
keeping log routing simple). Inside a run, every site is scraped in its own
thread via scrape_jobs(site_name=[site]) so one failing board doesn't abort
the others — scrape_jobs itself re-raises the first scraper exception.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from jobspy import scrape_jobs
from jobspy.model import Country
from webapp import store
from webapp.profile import load_profile
from webapp.settings import load_settings, mark_fired
from webapp.templates import get_template

SCRAPE_KEYS = (
    "search_term",
    "google_search_term",
    "location",
    "distance",
    "is_remote",
    "job_type",
    "easy_apply",
    "results_wanted",
    "country_indeed",
    "proxies",
    "ca_cert",
    "description_format",
    "linkedin_fetch_description",
    "linkedin_company_ids",
    "offset",
    "hours_old",
    "enforce_annual_salary",
    "user_agent",
)

# Countries whose third tuple element exists (Glassdoor domain).
GLASSDOOR_COUNTRIES = {c.value[0].split(",")[0] for c in Country if len(c.value) == 3}

_queue: "queue.Queue[int]" = queue.Queue()
_current_run: int | None = None
_cancelled: set[int] = set()


class _RunLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        if _current_run is None:
            return
        site = record.name.split(":", 1)[-1]
        line = f"{datetime.now():%H:%M:%S} [{site}] {record.levelname.lower()}: {record.getMessage()}"
        try:
            store.append_run_log(_current_run, line)
        except Exception:
            pass


def _attach_log_handler() -> None:
    handler = _RunLogHandler(level=logging.INFO)
    for name in list(logging.root.manager.loggerDict):
        if name.startswith("JobSpy:"):
            logger = logging.getLogger(name)
            if not any(isinstance(h, _RunLogHandler) for h in logger.handlers):
                logger.addHandler(handler)


def site_params(params: dict, site: str) -> dict:
    merged = {**params, **(params.get("overrides") or {}).get(site, {})}
    out = {k: merged.get(k) for k in SCRAPE_KEYS if merged.get(k) not in (None, "", [])}
    if site == "google" and not out.get("google_search_term"):
        term = out.get("search_term") or ""
        loc = f" near {out['location']}" if out.get("location") else ""
        remote = " remote" if out.get("is_remote") else ""
        out["google_search_term"] = f"{term} jobs{loc}{remote}".strip()
    if isinstance(out.get("proxies"), str):
        out["proxies"] = [p.strip() for p in out["proxies"].replace("\n", ",").split(",") if p.strip()]
    for k in ("distance", "results_wanted", "hours_old", "offset"):
        if k in out:
            out[k] = int(out[k])
    return out


def validate(params: dict) -> list[str]:
    """Human-readable warnings about param combinations the boards ignore."""
    warnings = []
    sites = params.get("sites") or []
    for site in sites:
        p = site_params(params, site)
        if site == "indeed":
            active = [k for k in ("hours_old", "easy_apply") if p.get(k)]
            if p.get("is_remote") or p.get("job_type"):
                active.append("job_type/is_remote")
            if len(active) > 1:
                warnings.append(
                    f"Indeed aceita só um entre hours_old, job_type/is_remote e easy_apply — "
                    f"será usado '{active[0]}' (ativos: {', '.join(active)})."
                )
        if site == "linkedin" and p.get("hours_old") and p.get("easy_apply"):
            warnings.append("LinkedIn: hours_old e easy_apply não funcionam juntos.")
        if site == "glassdoor":
            country = (p.get("country_indeed") or "usa").lower()
            if country not in GLASSDOOR_COUNTRIES and country not in ("us", "united states", "uk", "united kingdom"):
                warnings.append(f"Glassdoor não está disponível para o país '{country}'.")
        if site == "zip_recruiter" and (p.get("country_indeed") or "usa").lower() not in ("usa", "us", "united states", "canada"):
            warnings.append("ZipRecruiter só tem vagas dos EUA/Canadá.")
        if site == "linkedin" and p.get("results_wanted", 15) > 100 and not p.get("proxies"):
            warnings.append("LinkedIn costuma bloquear (429) por volta da 10ª página sem proxies.")
    return warnings


def enqueue(params: dict, label: str, template_id: str | None) -> int:
    run_id = store.create_run(label, template_id, params)
    _queue.put(run_id)
    return run_id


def cancel(run_id: int) -> bool:
    run = store.get_run(run_id)
    if run and run["status"] == "queued":
        _cancelled.add(run_id)
        store.update_run(run_id, status="cancelled")
        return True
    return False


def _scrape_site(site: str, params: dict) -> tuple[str, list[dict] | None, str | None, float]:
    started = time.time()
    try:
        df = scrape_jobs(site_name=[site], verbose=2, **site_params(params, site))
        records = df.to_dict(orient="records") if not df.empty else []
        return site, records, None, time.time() - started
    except Exception as e:  # noqa: BLE001 — surface any scraper failure to the UI
        return site, None, f"{type(e).__name__}: {e}", time.time() - started


def _process(run_id: int) -> None:
    global _current_run
    run = store.get_run(run_id)
    if not run or run_id in _cancelled:
        return
    params = run["params"]
    disabled = set(load_settings()["disabled_sites"])
    skipped = [s for s in params.get("sites") or [] if s in disabled]
    sites = [s for s in params.get("sites") or [] if s not in disabled]
    _current_run = run_id
    site_status = {s: {"status": "running", "count": 0} for s in sites}
    site_status.update({s: {"status": "skipped", "count": 0} for s in skipped})
    store.update_run(run_id, status="running", sites=site_status)
    for s in skipped:
        store.append_run_log(run_id, f"[{s}] ignorado: site desativado em Automação")
    for w in validate(params):
        store.append_run_log(run_id, f"aviso: {w}")
    _attach_log_handler()

    profile = load_profile()
    total = new = 0
    errors = 0
    with ThreadPoolExecutor(max_workers=max(1, len(sites))) as pool:
        futures = [pool.submit(_scrape_site, s, params) for s in sites]
        _attach_log_handler()  # loggers created lazily on first scrape
        for fut in futures:
            site, records, error, secs = fut.result()
            if error:
                errors += 1
                site_status[site] = {"status": "error", "count": 0, "error": error, "secs": round(secs, 1)}
                store.append_run_log(run_id, f"{datetime.now():%H:%M:%S} [{site}] erro: {error}")
            else:
                t, n = store.upsert_jobs(records, profile, run_id, run["template_id"], params.get("region"))
                total += t
                new += n
                site_status[site] = {"status": "done", "count": t, "new": n, "secs": round(secs, 1)}
            store.update_run(run_id, sites=site_status, total=total, new_count=new)

    status = "error" if errors == len(sites) and sites else ("partial" if errors else "done")
    store.update_run(
        run_id,
        status=status,
        finished_at=datetime.now().isoformat(timespec="seconds"),
        sites=site_status,
        total=total,
        new_count=new,
    )
    _current_run = None


def _worker() -> None:
    while True:
        run_id = _queue.get()
        try:
            _process(run_id)
        except Exception as e:  # noqa: BLE001
            store.update_run(run_id, status="error", finished_at=datetime.now().isoformat(timespec="seconds"))
            store.append_run_log(run_id, f"falha inesperada: {e}")
        finally:
            _queue.task_done()


# ------------------------------------------------------------------ automation

def cleanup(dry_run: bool = False) -> dict:
    cfg = load_settings()
    run_ids = store.old_run_ids(int(cfg["runs_keep_days"])) if cfg["runs_keep_days"] else []
    archived = store.archive_stale(int(cfg["archive_after_days"]), dry_run) if cfg["archive_after_days"] else 0
    if run_ids and not dry_run:
        store.delete_runs(run_ids, delete_jobs=False)
    return {"archived": archived, "runs_deleted": len(run_ids)}


def schedule_params(schedule: dict, template: dict, now: datetime) -> dict:
    """With recent_only, look back only to the previous firing (min 24h, max 14 days)."""
    params = {**template["params"], "overrides": template.get("overrides", {}), "region": template.get("region")}
    if schedule.get("recent_only"):
        hours = 24
        if schedule.get("last_fired"):
            last = datetime.fromisoformat(schedule["last_fired"])
            hours = int((now - last).total_seconds() // 3600) + 2
        params["hours_old"] = max(24, min(hours, 336))
    return params


def due_schedules(now: datetime) -> list[dict]:
    """Enabled schedules whose time today has passed and that haven't fired today.
    A schedule missed while the server was off still fires when it comes back (same day)."""
    out = []
    for s in load_settings()["schedules"]:
        if not s.get("enabled", True) or now.weekday() not in s.get("days", range(7)):
            continue
        hh, mm = (int(x) for x in s.get("time", "09:00").split(":"))
        if now < now.replace(hour=hh, minute=mm, second=0, microsecond=0):
            continue
        if s.get("last_fired") and s["last_fired"][:10] == now.date().isoformat():
            continue
        out.append(s)
    return out


def _scheduler() -> None:
    last_cleanup = None
    while True:
        now = datetime.now()
        try:
            if last_cleanup != now.date():
                cleanup()
                last_cleanup = now.date()
            for s in due_schedules(now):
                tpl = get_template(s["template_id"])
                mark_fired(s["id"], now.isoformat(timespec="seconds"))
                if tpl:
                    enqueue(schedule_params(s, tpl, now), f"⏰ {tpl['name']}", tpl["id"])
        except Exception as e:  # noqa: BLE001 — never let the loop die
            logging.getLogger("webapp").warning("scheduler: %s", e)
        time.sleep(30)


def start() -> None:
    store.mark_interrupted_runs()
    threading.Thread(target=_worker, name="jobspy-runner", daemon=True).start()
    threading.Thread(target=_scheduler, name="jobspy-scheduler", daemon=True).start()
