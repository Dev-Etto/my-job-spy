"""
App settings and scheduled searches, stored in webapp/data/settings.json.

Schedules: {id, template_id, time "HH:MM", days [0=Mon..6=Sun], recent_only,
enabled, last_fired}. last_fired is owned by the scheduler — saves from the UI
never overwrite it, otherwise a schedule could fire twice on the same day.
"""

from __future__ import annotations

import copy
import json
import threading
import time

from webapp.profile import DATA_DIR

SETTINGS_PATH = DATA_DIR / "settings.json"

DEFAULT_SETTINGS = {
    # untriaged ('new') jobs no search has seen for this many days become 'archived'
    "archive_after_days": 21,
    # finished runs older than this are removed from history (jobs are kept)
    "runs_keep_days": 30,
    # applied jobs without news for this many days get a follow-up reminder
    "followup_days": 7,
    # sites skipped by every run (e.g. Google when it keeps returning 0)
    "disabled_sites": [],
    "schedules": [],
}

_lock = threading.Lock()


def _read() -> dict:
    data = copy.deepcopy(DEFAULT_SETTINGS)
    if SETTINGS_PATH.exists():
        try:
            data.update(json.loads(SETTINGS_PATH.read_text()))
        except (OSError, json.JSONDecodeError):
            pass
    return data


def _write(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def load_settings() -> dict:
    with _lock:
        return _read()


def save_settings(new: dict) -> dict:
    with _lock:
        current = _read()
        fired = {s["id"]: s.get("last_fired") for s in current["schedules"]}
        data = {**current, **{k: v for k, v in new.items() if k in DEFAULT_SETTINGS}}
        for i, s in enumerate(data["schedules"]):
            s.setdefault("id", f"sch-{int(time.time() * 1000)}-{i}")
            s["last_fired"] = fired.get(s["id"])
        _write(data)
        return data


def mark_fired(schedule_id: str, when: str) -> None:
    with _lock:
        data = _read()
        for s in data["schedules"]:
            if s["id"] == schedule_id:
                s["last_fired"] = when
        _write(data)
