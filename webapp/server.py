"""
JobSpy web UI.

    .venv/bin/python -m webapp.server        # http://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # use the repo's jobspy, not an installed copy

import pandas as pd  # noqa: E402
from fastapi import Body, FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from jobspy.model import Country, JobType, Site  # noqa: E402
from webapp import cv_import, runner, store  # noqa: E402
from webapp.settings import load_settings, save_settings  # noqa: E402
from webapp.profile import load_profile, reset_profile, save_profile  # noqa: E402
from webapp.templates import (  # noqa: E402
    all_templates,
    delete_user_template,
    get_template,
    replace_user_templates,
    save_user_template,
)

STATIC = Path(__file__).parent / "static"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.conn()
    runner.start()
    yield


app = FastAPI(title="JobSpy UI", lifespan=lifespan)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/meta")
def meta():
    return {
        "sites": [s.value for s in Site],
        "countries": sorted(c.value[0].split(",")[0] for c in Country if c not in (Country.US_CANADA, Country.WORLDWIDE)),
        "glassdoor_countries": sorted(runner.GLASSDOOR_COUNTRIES),
        "job_types": [j.value[0] for j in JobType],
        "statuses": list(store.STATUSES),
        "templates": all_templates(),
        "profile": load_profile(),
        "settings": load_settings(),
    }


# ------------------------------------------------------------------ jobs

@app.get("/api/jobs")
def jobs():
    return store.list_jobs()


@app.patch("/api/jobs")
def update_jobs(payload: dict = Body(...)):
    ids = payload.get("ids") or []
    status = payload.get("status")
    if status is not None and status not in store.STATUSES:
        raise HTTPException(400, f"status inválido: {status}")
    return {"updated": store.update_jobs(
        ids, status=status, notes=payload.get("notes"),
        seen=bool(payload.get("seen")), followup=bool(payload.get("followup")),
    )}


@app.post("/api/jobs/delete")
def delete_jobs(payload: dict = Body(...)):
    if not payload.get("ids") and not payload.get("status") and not payload.get("all"):
        raise HTTPException(400, "informe ids, status ou all")
    return {"deleted": store.delete_jobs(status=payload.get("status"), ids=payload.get("ids"))}


@app.post("/api/import-csv")
def import_csv(payload: dict = Body(...)):
    path = (ROOT / payload.get("path", "jobs.csv")).resolve()
    if ROOT not in path.parents or not path.is_file():
        raise HTTPException(400, f"arquivo não encontrado dentro do projeto: {path}")
    df = pd.read_csv(path)
    total, new = store.upsert_jobs(
        df.to_dict(orient="records"), load_profile(), None, "import-csv", payload.get("region")
    )
    return {"total": total, "new": new}


# ------------------------------------------------------------------ runs

@app.post("/api/validate")
def validate(params: dict = Body(...)):
    return {"warnings": runner.validate(params)}


@app.post("/api/runs")
def create_runs(payload: dict = Body(...)):
    """Either {params, label} for an ad-hoc search or {template_ids: [...]}."""
    run_ids = []
    if payload.get("template_ids"):
        for tid in payload["template_ids"]:
            tpl = get_template(tid)
            if not tpl:
                raise HTTPException(404, f"template não encontrado: {tid}")
            params = {**tpl["params"], "overrides": tpl.get("overrides", {}), "region": tpl.get("region")}
            if payload.get("proxies"):
                params["proxies"] = payload["proxies"]
            run_ids.append(runner.enqueue(params, tpl["name"], tid))
    else:
        params = payload.get("params") or {}
        if not params.get("sites"):
            raise HTTPException(400, "selecione ao menos um site")
        label = payload.get("label") or params.get("search_term") or params.get("google_search_term") or "Busca"
        run_ids.append(runner.enqueue(params, label, payload.get("template_id")))
    return {"run_ids": run_ids}


@app.get("/api/runs")
def runs():
    return store.list_runs()


@app.get("/api/runs/{run_id}")
def run(run_id: int):
    r = store.get_run(run_id)
    if not r:
        raise HTTPException(404)
    return r


@app.post("/api/runs/delete")
def delete_runs(payload: dict = Body(...)):
    """{ids: [...]} or {all: true}; running/queued runs are never deleted."""
    runs_ = store.list_runs(limit=100000)
    active = {r["id"] for r in runs_ if r["status"] in ("queued", "running")}
    ids = [r["id"] for r in runs_] if payload.get("all") else [int(i) for i in payload.get("ids") or []]
    if any(i in active for i in ids) and not payload.get("all"):
        raise HTTPException(409, "não é possível excluir uma busca em andamento (cancele ou aguarde)")
    ids = [i for i in ids if i not in active]
    return store.delete_runs(ids, bool(payload.get("delete_jobs")))


@app.post("/api/runs/{run_id}/cancel")
def cancel_run(run_id: int):
    return {"cancelled": runner.cancel(run_id)}


# ------------------------------------------------------------------ templates

@app.post("/api/templates")
def create_template(template: dict = Body(...)):
    if not template.get("name") or not template.get("params"):
        raise HTTPException(400, "name e params são obrigatórios")
    return save_user_template(template)


@app.delete("/api/templates/{template_id}")
def remove_template(template_id: str):
    delete_user_template(template_id)
    return {"ok": True}


# ------------------------------------------------------------------ automation

@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(payload: dict = Body(...)):
    for s in payload.get("schedules") or []:
        if not get_template(s.get("template_id", "")):
            raise HTTPException(400, f"template não encontrado: {s.get('template_id')}")
    return save_settings(payload)


@app.post("/api/cleanup")
def post_cleanup(payload: dict = Body(default={})):
    return runner.cleanup(dry_run=bool(payload.get("dry_run")))


# ------------------------------------------------------------------ CV import

@app.post("/api/cv/parse")
async def cv_parse(request: Request):
    """Raw PDF bytes in the body → proposed profile + templates (nothing is saved)."""
    data = await request.body()
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "envie um arquivo PDF")
    try:
        return cv_import.build_from_pdf(data)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/cv/apply")
def cv_apply(payload: dict = Body(...)):
    out = {}
    if payload.get("profile"):
        save_profile(payload["profile"])
        out["reanalyzed"] = store.reanalyze_all(payload["profile"])
    if payload.get("templates") is not None:
        # generated templates replace the previous generated set; hand-made ones stay
        replace_user_templates(lambda t: not t.get("generated"), payload["templates"])
        out["templates"] = len(payload["templates"])
    return out


# ------------------------------------------------------------------ profile

@app.get("/api/profile")
def get_profile():
    return load_profile()


@app.put("/api/profile")
def put_profile(profile: dict = Body(...)):
    save_profile(profile)
    return {"profile": profile, "reanalyzed": store.reanalyze_all(profile)}


@app.post("/api/profile/reset")
def post_profile_reset():
    profile = reset_profile()
    return {"profile": profile, "reanalyzed": store.reanalyze_all(profile)}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _port_in_use(port: int) -> bool:
    with socket.socket() as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="JobSpy UI")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8765)))
    parser.add_argument("--open", action="store_true", help="abre o navegador")
    parser.add_argument("--reload", action="store_true", help="reinicia sozinho ao editar arquivos .py")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"

    if _port_in_use(args.port):
        print(f"\n  JobSpy UI já está rodando → {url}\n")
        if args.open:
            webbrowser.open(url)
        sys.exit(0)
    print(f"\n  JobSpy UI → {url}\n")
    if args.open:
        threading.Timer(1.2, webbrowser.open, (url,)).start()
    uvicorn.run(
        "webapp.server:app" if args.reload else app,
        host="127.0.0.1",
        port=args.port,
        log_level="warning",
        reload=args.reload,
        reload_dirs=[str(Path(__file__).parent)] if args.reload else None,
        reload_includes=["*.py"] if args.reload else None,
    )
