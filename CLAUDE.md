# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

JobSpy (`python-jobspy` on PyPI) is a library that scrapes job boards (LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Bayt, Naukri, BDJobs) concurrently and returns a single pandas DataFrame. The public API is one function: `jobspy.scrape_jobs(...)`.

## Commands

```bash
poetry install                  # install deps (Python ^3.10); a .venv exists at repo root
poetry run python test.py       # ad-hoc manual run (test.py is a local scratch script, not a test suite)
black --line-length=88 jobspy   # formatting (also enforced by pre-commit)
pre-commit run --all-files
poetry build                    # build sdist/wheel
```

There is no automated test suite and no linter beyond black. Verify changes by calling `scrape_jobs` against a real site, e.g.:

```bash
poetry run python -c "from jobspy import scrape_jobs; print(scrape_jobs(site_name='indeed', search_term='python', results_wanted=5, verbose=2))"
```

Publishing: the GitHub Action builds on every push to `main` but only publishes to PyPI on tags or manual dispatch. Bump `version` in `pyproject.toml` when releasing.

## Architecture

- `jobspy/__init__.py` — `scrape_jobs()`: builds a `ScraperInput`, runs one scraper per site in a `ThreadPoolExecutor`, then flattens each `JobPost` into a row (joins `job_type`/`emails`/`skills` lists into strings, renders `Location` via `display_location()`, expands `compensation` into `interval`/`min_amount`/`max_amount`/`currency`, falls back to regex salary extraction from the description for USA only, optionally annualizes). Columns are reordered by `desired_order` in `util.py` and sorted by site then `date_posted`.
- `jobspy/model.py` — all shared types: `Site`, `ScraperInput`, `JobPost`, `JobResponse`, `Location`, `Compensation`, the abstract `Scraper` base, `JobType` (each member is a tuple of localized strings matched against site data), and `Country` (tuple of names, Indeed subdomain[:api code], Glassdoor domain — Glassdoor is unavailable for countries lacking the third element).
- `jobspy/<site>/` — one package per board, each with `__init__.py` (the `Scraper` subclass implementing `scrape(scraper_input) -> JobResponse`), and usually `constant.py` (headers, GraphQL queries, payloads) and `util.py` (site-specific parsing).
- `jobspy/util.py` — shared helpers: `create_session()` (returns a `tls_client`-based `TLSRotating` session by default, or `RequestsRotating` with retry/backoff when `is_tls=False`; both rotate through the `proxies` list per request), logger creation (`create_logger("Indeed")` → `JobSpy:Indeed`), HTML→markdown/plain conversion, salary/email/job-type extraction, `desired_order`.
- `jobspy/exception.py` — one exception class per site.

### Adding a new site

Touch all of: a `Site` enum member in `model.py`, a new `jobspy/<site>/` package with a `Scraper` subclass whose `__init__` accepts `proxies`, `ca_cert`, `user_agent` (that's how `scrape_jobs` instantiates every scraper), an entry in `SCRAPER_MAPPING` in `jobspy/__init__.py`, an exception in `exception.py`, and any new `JobPost` fields added to both `model.py` and `desired_order` in `util.py` (columns not in `desired_order` are dropped from output).

## Web UI (`webapp/`)

Local FastAPI app + vanilla JS front (no build step): `./start.sh` (opens the browser, auto-reloads on `.py` edits) or `.venv/bin/python -m webapp.server [--open] [--reload] [--port N]` → http://127.0.0.1:8765. Deps: `webapp/requirements.txt` (fastapi, uvicorn, pypdf — kept out of `pyproject.toml` so the published package is unaffected). `server.py` prepends the repo root to `sys.path` so the local `jobspy` is used, not the PyPI copy in `.venv`. Everything user-specific lives in `webapp/data/` (gitignored): `jobs.db`, `profile.json`, `templates.json`, `settings.json`.

- `runner.py` — single-worker queue; each run scrapes every site in its own thread via `scrape_jobs(site_name=[site])` so one failing board doesn't abort the rest. Per-site `overrides` in params are merged in `site_params()`; `disabled_sites` from settings are skipped. Logs are captured by attaching a handler to the `JobSpy:*` loggers (they don't propagate). A second thread is the scheduler: every 30s it fires due schedules (missed ones still fire later the same day; `recent_only` sets `hours_old` to the time since the last firing) and runs `cleanup()` once a day.
- `store.py` — SQLite. Jobs dedup by `job_url` hash, keep triage `status` (`STATUSES`), `notes`, `seen_at`, `applied_at`, `followup_at`; raw fields + analysis as JSON. New columns are added at startup via `_MIGRATIONS`. `archive_stale()` moves untouched `new` jobs to `archived`; an archived job found again goes back to `new`.
- `settings.py` — `settings.json` (cleanup thresholds, follow-up days, disabled sites, schedules). `save_settings` never overwrites a schedule's `last_fired` (owned by the scheduler).
- `analysis.py` + `profile.py` — regex heuristics (seniority from title, remote/hybrid, CLT/PJ, English requirement, years, BRL salary from description) and a 0–100 score against the CV-derived profile; editing the profile in the UI re-analyzes all jobs.
- `cv_import.py` — PDF → proposed profile + templates (group "Do seu CV", flagged `generated`) by matching the text against `CATALOG`; nothing is saved until `/api/cv/apply`.
- `templates.py` — built-in presets (Brasil / Internacional) + user templates in `templates.json`. A user template with a built-in's id (`edits_builtin`) replaces it; deleting it restores the original.
- `static/app.js` — all filtering/faceting happens client-side over `/api/jobs`. Same-job-on-several-sites grouping uses `dup_key` (only when company is set); status changes apply to the whole group. "Seen", the since-last-visit banner (localStorage `lastVisit`), run-finished toasts (from polling: 2s while active, 30s idle) and site health (from run history) are all computed in the browser.

## Site-specific constraints (from README)

- Indeed: only one of `hours_old`, (`job_type` & `is_remote`), `easy_apply` can be applied per search. Uses `country_indeed` to choose the domain; Glassdoor uses it too.
- LinkedIn: only one of `hours_old`, `easy_apply` per search; rate-limits around page 10 per IP (proxies effectively required). `linkedin_fetch_description=True` makes an extra request per job.
- All boards cap at roughly 1000 results per search.
