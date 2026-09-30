"""
Search templates recommended from the CV, plus user-saved templates.

A template is a set of scrape_jobs() params shared by all sites, and
`overrides` per site, needed because each board reacts differently:
- Indeed: hours_old disables the is_remote/job_type filters, so for BR we
  put "remoto" in the term and keep hours_old; for the US we drop hours_old
  to get the real remote filter.
- LinkedIn: location accepts regions such as "Latin America", "Worldwide",
  "European Union"; is_remote maps to f_WT=2.
- Google: only google_search_term is used when present, so it is written
  as a natural-language query.
"""

from __future__ import annotations

import json
import re
import time

from webapp.profile import DATA_DIR

USER_TEMPLATES_PATH = DATA_DIR / "templates.json"

_BR = {
    "country_indeed": "brazil",
    "location": "Brazil",
    "is_remote": True,
    "hours_old": 168,
    "results_wanted": 50,
    "linkedin_fetch_description": True,
}

_INTL = {
    "country_indeed": "usa",
    "is_remote": True,
    "hours_old": 168,
    "results_wanted": 50,
    "linkedin_fetch_description": True,
}


def _t(id, group, name, why, params, overrides=None, region="br", tags=()):
    base = _BR if region == "br" else _INTL
    return {
        "id": id,
        "group": group,
        "name": name,
        "why": why,
        "region": region,
        "tags": list(tags),
        "builtin": True,
        "params": {**base, **params},
        "overrides": overrides or {},
    }


BUILTIN_TEMPLATES = [
    # ---------------------------------------------------------------- Brasil
    _t(
        "br-fullstack-node-react",
        "Brasil",
        "Full Stack Pleno · Node + React (remoto)",
        "Seu cargo atual: Full Stack end-to-end com Node/Fastify/TS no back e React no front. Melhor encaixe direto.",
        {
            "sites": ["indeed", "linkedin", "google"],
            "search_term": "desenvolvedor full stack node react",
            "google_search_term": "vagas desenvolvedor full stack pleno node react typescript remoto",
        },
        {"indeed": {"search_term": "full stack node react remoto"}},
        tags=["pleno", "fullstack", "node", "react"],
    ),
    _t(
        "br-backend-node-ts",
        "Brasil",
        "Back-end Node.js / TypeScript Pleno (remoto)",
        "Você construiu do zero uma API Fastify + Prisma + PostgreSQL com 1.000+ testes de integração — perfil back-end Node forte.",
        {
            "sites": ["indeed", "linkedin", "google"],
            "search_term": "desenvolvedor back-end node.js typescript",
            "google_search_term": "vagas desenvolvedor backend node.js typescript pleno remoto",
        },
        {"indeed": {"search_term": "backend node typescript remoto"}},
        tags=["pleno", "backend", "node"],
    ),
    _t(
        "br-java-spring",
        "Brasil",
        "Back-end Java / Spring Boot (remoto)",
        "Java + Spring Boot + RabbitMQ no projeto Flow Pay. Mercado Java no Brasil é enorme (bancos, fintechs, consultorias).",
        {
            "sites": ["indeed", "linkedin", "google"],
            "search_term": "desenvolvedor java spring boot",
            "google_search_term": "vagas desenvolvedor java spring boot pleno remoto",
        },
        {"indeed": {"search_term": "java spring boot remoto"}},
        tags=["backend", "java"],
    ),
    _t(
        "br-react-next",
        "Brasil",
        "React / Next.js · Front-heavy Full Stack (remoto)",
        "Você mantém 3 aplicações web + landing page em React/Next.js. Abre vagas front-end e full stack com foco em produto.",
        {
            "sites": ["indeed", "linkedin", "google"],
            "search_term": "desenvolvedor react next.js",
            "google_search_term": "vagas desenvolvedor react next.js typescript pleno remoto",
        },
        {"indeed": {"search_term": "react next.js remoto"}},
        tags=["frontend", "react", "next"],
    ),
    _t(
        "br-golang",
        "Brasil",
        "Desenvolvedor Go / Golang (remoto)",
        "Projetos em Go (API de Vagas com Gin/GORM, CV Manager com GraphQL). Nicho com menos concorrência e bons salários.",
        {
            "sites": ["indeed", "linkedin", "google"],
            "search_term": "desenvolvedor golang",
            "google_search_term": "vagas desenvolvedor golang backend remoto",
        },
        {"indeed": {"search_term": "golang remoto"}},
        tags=["backend", "go"],
    ),
    _t(
        "br-cloud-gcp",
        "Brasil",
        "Back-end com Cloud / DevOps (GCP, Docker, CI/CD)",
        "Você arquitetou CI/CD de 5 projetos em Cloud Run + Firebase + Docker. Diferencial para vagas back-end com ownership de infra.",
        {
            "sites": ["indeed", "linkedin", "google"],
            "search_term": "desenvolvedor backend gcp docker",
            "google_search_term": "vagas desenvolvedor backend google cloud gcp docker ci/cd remoto",
        },
        {"indeed": {"search_term": "backend gcp docker remoto"}},
        tags=["backend", "cloud"],
    ),
    _t(
        "br-software-engineer-startups",
        "Brasil",
        "Software Engineer · Startups e Produto (remoto)",
        "Startups BR costumam anunciar em inglês ('Software Engineer'). Seu histórico de dono de produto (Portüs) pesa muito aqui.",
        {
            "sites": ["linkedin", "indeed", "google"],
            "search_term": "software engineer typescript",
            "google_search_term": "software engineer typescript node startup remoto brasil",
        },
        {"indeed": {"search_term": "software engineer typescript remoto"}},
        tags=["startup", "produto"],
    ),
    _t(
        "br-recife-pe",
        "Brasil",
        "Recife / PE · Híbrido ou presencial",
        "Você mora em Caruaru (PE). Porto Digital em Recife concentra muitas empresas de tecnologia — vale olhar híbrido.",
        {
            "sites": ["indeed", "linkedin"],
            "search_term": "desenvolvedor",
            "location": "Recife, PE",
            "distance": 100,
            "is_remote": False,
            "hours_old": 336,
        },
        {"linkedin": {"location": "Recife, Pernambuco, Brazil"}},
        tags=["local", "hibrido"],
    ),
    _t(
        "br-caruaru-pe",
        "Brasil",
        "Caruaru / PE · Híbrido ou presencial",
        "Sua cidade. Poucas vagas de dev no Agreste, então o termo é amplo e a janela é de 30 dias — o score separa o que encaixa.",
        {
            "sites": ["indeed", "linkedin"],
            "search_term": "desenvolvedor",
            "location": "Caruaru, PE",
            "distance": 25,
            "is_remote": False,
            "hours_old": 720,
        },
        {"linkedin": {"location": "Caruaru, Pernambuco, Brazil"}},
        tags=["local", "hibrido", "presencial"],
    ),
    _t(
        "br-pleno-geral",
        "Brasil",
        "Pleno geral · varredura ampla (remoto)",
        "Busca ampla por 'pleno' — use os filtros de stack e o score para separar o que encaixa.",
        {
            "sites": ["indeed", "linkedin"],
            "search_term": "desenvolvedor pleno",
            "results_wanted": 100,
            "linkedin_fetch_description": False,
        },
        {"indeed": {"search_term": "desenvolvedor pleno remoto"}},
        tags=["amplo"],
    ),
    # ---------------------------------------------------------- Internacional
    _t(
        "intl-latam-fullstack",
        "Internacional",
        "LATAM remoto · Full Stack Node/React (USD)",
        "Empresas dos EUA contratam muito via LATAM (contractor, pagamento em USD). Sua stack TS/Node/React é a mais pedida.",
        {
            "sites": ["linkedin", "google"],
            "search_term": "full stack engineer node react",
            "location": "Latin America",
            "google_search_term": "remote full stack developer node react typescript latin america",
        },
        region="intl",
        tags=["latam", "usd", "fullstack"],
    ),
    _t(
        "intl-latam-backend",
        "Internacional",
        "LATAM remoto · Backend Node.js / TypeScript",
        "Backend Node com Postgres/Prisma e testes — perfil clássico de contractor LATAM.",
        {
            "sites": ["linkedin", "google"],
            "search_term": "backend engineer node.js typescript",
            "location": "Latin America",
            "google_search_term": "remote backend engineer node.js typescript latam",
        },
        region="intl",
        tags=["latam", "usd", "backend"],
    ),
    _t(
        "intl-worldwide-remote",
        "Internacional",
        "Worldwide remoto · TypeScript (anywhere)",
        "Vagas 'work from anywhere' no LinkedIn — aceita candidatos do Brasil sem visto.",
        {
            "sites": ["linkedin", "google"],
            "search_term": "typescript developer",
            "location": "Worldwide",
            "google_search_term": "remote typescript developer work from anywhere",
        },
        region="intl",
        tags=["anywhere"],
    ),
    _t(
        "intl-us-remote",
        "Internacional",
        "EUA remoto · Software Engineer TypeScript",
        "Maior mercado, mas muitas vagas exigem autorização de trabalho nos EUA — use o filtro de texto 'authorization' para descartar.",
        {
            "sites": ["indeed", "linkedin"],
            "search_term": "software engineer typescript node",
            "location": "United States",
            "country_indeed": "usa",
        },
        {"indeed": {"hours_old": None, "location": None}},
        region="intl",
        tags=["usa"],
    ),
    _t(
        "intl-europe-remote",
        "Internacional",
        "Europa remoto · Backend Node / Go",
        "Empresas europeias remote-first contratam como contractor B2B. Go + Node é um bom combo.",
        {
            "sites": ["linkedin"],
            "search_term": "backend developer node.js",
            "location": "European Union",
        },
        region="intl",
        tags=["europa"],
    ),
    _t(
        "intl-portugal",
        "Internacional",
        "Portugal · Full Stack (idioma a favor)",
        "Português nativo elimina a barreira do inglês intermediário; Portugal tem visto para profissionais de TI.",
        {
            "sites": ["indeed", "linkedin"],
            "search_term": "full stack developer node react",
            "location": "Portugal",
            "country_indeed": "portugal",
            "is_remote": False,
            "hours_old": 336,
        },
        {"indeed": {"location": None}},
        region="intl",
        tags=["portugal", "europa"],
    ),
    _t(
        "intl-java-remote",
        "Internacional",
        "Java / Spring Boot remoto (LATAM + Worldwide)",
        "Java é forte em fintechs internacionais; combine com seu projeto de pagamentos assíncronos (Flow Pay).",
        {
            "sites": ["linkedin", "google"],
            "search_term": "java spring boot developer",
            "location": "Latin America",
            "google_search_term": "remote java spring boot developer latam",
        },
        region="intl",
        tags=["java", "latam"],
    ),
]


def load_user_templates() -> list[dict]:
    if USER_TEMPLATES_PATH.exists():
        try:
            return json.loads(USER_TEMPLATES_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            return []
    return []


def all_templates() -> list[dict]:
    """Built-ins come first; a user copy with a built-in's id replaces it (edited preset)."""
    user = load_user_templates()
    edited = {t["id"]: t for t in user if t.get("edits_builtin")}
    builtins = [edited.get(t["id"], t) for t in BUILTIN_TEMPLATES]
    return builtins + [t for t in user if not t.get("edits_builtin")]


def get_template(template_id: str) -> dict | None:
    return next((t for t in all_templates() if t["id"] == template_id), None)


def save_user_template(template: dict) -> dict:
    templates = load_user_templates()
    if not template.get("id"):
        slug = re.sub(r"[^a-z0-9]+", "-", template["name"].lower()).strip("-")
        template["id"] = f"user-{slug}-{int(time.time())}"
    template["builtin"] = False
    template["edits_builtin"] = any(t["id"] == template["id"] for t in BUILTIN_TEMPLATES)
    template.setdefault("group", "Meus templates")
    template.setdefault("overrides", {})
    templates = [t for t in templates if t["id"] != template["id"]] + [template]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_TEMPLATES_PATH.write_text(json.dumps(templates, ensure_ascii=False, indent=2))
    return template


def delete_user_template(template_id: str) -> None:
    """For an edited built-in this restores the original."""
    replace_user_templates(lambda t: t["id"] != template_id)


def replace_user_templates(keep, new: list[dict] = ()) -> None:
    templates = [t for t in load_user_templates() if keep(t)] + list(new)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USER_TEMPLATES_PATH.write_text(json.dumps(templates, ensure_ascii=False, indent=2))
