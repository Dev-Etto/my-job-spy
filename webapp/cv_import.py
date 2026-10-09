"""
Builds a scoring profile and search templates from a CV PDF.

Pure heuristics, no LLM: the CV text is matched against a catalog of common
stacks. Found stacks become profile skills (weight grows with mentions);
catalog stacks missing from the CV become "avoid" entries. Years of
experience, city/state and English level are read with regexes. The result is
a proposal — the UI shows it before anything is saved.
"""

from __future__ import annotations

import copy
import io
import re

from pypdf import PdfReader

from webapp.analysis import normalize
from webapp.profile import DEFAULT_PROFILE
from webapp.templates import _t

# name, patterns, base weight, kind, weight when used as an "avoid" entry (0 = never avoid)
CATALOG = [
    ("TypeScript", [r"typescript", r"\bts\b"], 10, "lang", 0),
    ("JavaScript", [r"javascript", r"\bjs\b"], 5, "lang", 0),
    ("Node.js", [r"node\.?js", r"\bnode\b", r"nestjs", r"express"], 10, "back", 0),
    ("Java", [r"\bjava\b(?!\s*script)"], 8, "back", 6),
    ("Spring Boot", [r"spring"], 7, "back", 0),
    ("Go", [r"\bgolang\b", r"\bgo\s+(developer|engineer|backend|dev)\b", r"\b(em|in|with|com)\s+go\b", r"[,/(:]\s*go\s*[,/).]"], 6, "back", 0),
    ("Python", [r"\bpython\b", r"django", r"fastapi", r"flask"], 8, "back", 4),
    (".NET/C#", [r"\.net\b", r"\bc#", r"c sharp", r"dotnet", r"asp\.net"], 8, "back", 10),
    ("PHP/Laravel", [r"\bphp\b", r"laravel", r"wordpress"], 8, "back", 10),
    ("Ruby", [r"\bruby\b", r"\brails\b"], 8, "back", 8),
    ("Kotlin", [r"\bkotlin\b"], 6, "back", 0),
    ("Elixir", [r"\belixir\b"], 6, "back", 0),
    ("Rust", [r"\brust\b"], 6, "back", 0),
    ("React", [r"\breact\b", r"react\.?js"], 8, "front", 0),
    ("Next.js", [r"next\.?js", r"\bnext\b"], 7, "front", 0),
    ("Angular", [r"angular"], 8, "front", 6),
    ("Vue", [r"\bvue\b", r"vue\.?js", r"nuxt"], 8, "front", 5),
    ("React Native", [r"react native"], 7, "mobile", 0),
    ("Mobile nativo", [r"\bswift\b", r"flutter", r"\bandroid\b", r"\bios\b"], 7, "mobile", 8),
    ("Fastify", [r"fastify"], 5, "back", 0),
    ("Prisma", [r"prisma"], 5, "db", 0),
    ("GraphQL", [r"graphql"], 5, "back", 0),
    ("REST APIs", [r"\brest(ful)?\b", r"\bapis?\b"], 3, "back", 0),
    ("PostgreSQL", [r"postgres"], 6, "db", 0),
    ("MySQL", [r"mysql", r"mariadb"], 4, "db", 0),
    ("MongoDB", [r"mongo"], 4, "db", 0),
    ("Redis", [r"\bredis\b"], 3, "db", 0),
    ("GCP", [r"\bgcp\b", r"google cloud", r"cloud run", r"firebase"], 6, "cloud", 0),
    ("AWS", [r"\baws\b", r"amazon web services"], 5, "cloud", 0),
    ("Azure", [r"\bazure\b"], 5, "cloud", 0),
    ("Docker", [r"docker", r"container"], 5, "devops", 0),
    ("Kubernetes", [r"kubernetes", r"\bk8s\b"], 5, "devops", 0),
    ("CI/CD", [r"ci\s*/\s*cd", r"github actions", r"pipeline"], 4, "devops", 0),
    ("RabbitMQ", [r"rabbitmq", r"mensageria", r"message (broker|queue)", r"pub\s*/?\s*sub", r"kafka"], 3, "back", 0),
    ("Testes", [r"testes? (automatizad|de integra|unit)", r"\bjest\b", r"vitest", r"integration test", r"\btdd\b"], 3, "other", 0),
    ("Clean Arch / SOLID", [r"clean arch", r"\bsolid\b", r"\bddd\b", r"arquitetura limpa"], 3, "other", 0),
    ("Dados/ML", [r"data scien", r"cientista de dados", r"machine learning", r"engenheiro de dados", r"data engineer"], 6, "data", 6),
]

# Avoid-only entries that aren't stacks someone lists as a skill.
ALWAYS_AVOID = [
    {"name": "Delphi/COBOL/legado", "weight": 10, "patterns": [r"delphi", r"cobol", r"\babap\b", r"\bprogress\b", r"genexus", r"oracle forms"]},
    {"name": "QA manual", "weight": 6, "patterns": [r"\bqa\b", r"quality assurance", r"analista de testes"]},
]

UF = {
    "ac": "acre", "al": "alagoas", "ap": "amapa", "am": "amazonas", "ba": "bahia", "ce": "ceara", "df": "distrito federal",
    "es": "espirito santo", "go": "goias", "ma": "maranhao", "mt": "mato grosso", "ms": "mato grosso do sul",
    "mg": "minas gerais", "pa": "para", "pb": "paraiba", "pr": "parana", "pe": "pernambuco", "pi": "piaui",
    "rj": "rio de janeiro", "rn": "rio grande do norte", "rs": "rio grande do sul", "ro": "rondonia", "rr": "roraima",
    "sc": "santa catarina", "sp": "sao paulo", "se": "sergipe", "to": "tocantins",
}
CAPITAL = {
    "pe": "Recife", "sp": "São Paulo", "rj": "Rio de Janeiro", "mg": "Belo Horizonte", "pr": "Curitiba",
    "rs": "Porto Alegre", "sc": "Florianópolis", "ba": "Salvador", "ce": "Fortaleza", "df": "Brasília",
    "go": "Goiânia", "pb": "João Pessoa", "rn": "Natal", "al": "Maceió", "se": "Aracaju", "pa": "Belém",
    "am": "Manaus", "es": "Vitória", "ma": "São Luís", "pi": "Teresina", "mt": "Cuiabá", "ms": "Campo Grande",
}
ENGLISH = ["basico", "intermediario", "avancado", "fluente"]


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return re.sub(r"\s+", " ", text).strip()


def _years(text_n: str) -> int | None:
    found = [int(n) for n in re.findall(r"(\d{1,2})\s*\+?\s*anos? de experiencia", text_n)]
    found += [int(n) for n in re.findall(r"(\d{1,2})\s*\+?\s*years? of experience", text_n)]
    return max(found) if found else None


def _location(text: str) -> tuple[str, str] | None:
    """First 'City, UF' / 'City - UF' in the CV (usually the header)."""
    for m in re.finditer(r"([A-ZÀ-Ú][\wÀ-ú]+(?: [A-ZÀ-Ú]?[\wÀ-ú]+){0,3})\s*[,–-]\s*([A-Z]{2})\b", text):
        if m.group(2).lower() in UF:
            return m.group(1).strip(), m.group(2).lower()
    return None


def _english(text_n: str) -> str | None:
    m = re.search(r"ingles\W{0,3}(?:\w+\W+){0,2}?(basico|intermediario|avancado|fluente)", text_n)
    if m:
        return m.group(1)
    m = re.search(r"english\W{0,3}(?:\w+\W+){0,2}?(basic|intermediate|advanced|fluent)", text_n)
    return dict(basic="basico", intermediate="intermediario", advanced="avancado", fluent="fluente")[m.group(1)] if m else None


def _role(text_n: str, kinds: set[str]) -> str:
    counts = {
        "fullstack": len(re.findall(r"full\s*-?\s*stack", text_n)),
        "backend": len(re.findall(r"back\s*-?\s*end", text_n)),
        "frontend": len(re.findall(r"front\s*-?\s*end", text_n)),
        "mobile": len(re.findall(r"\bmobile\b", text_n)),
    }
    # a full-stack CV usually also says "back-end" in older roles: any full-stack mention wins
    if counts["fullstack"] and {"back", "front"} <= kinds:
        return "fullstack"
    best = max(counts, key=counts.get)
    if counts[best]:
        return best
    if "back" in kinds and "front" in kinds:
        return "fullstack"
    return "frontend" if "front" in kinds and "back" not in kinds else "backend"


def _seniority(years: int | None) -> tuple[str, dict]:
    if years is None or years >= 3 and years < 6:
        return "pleno", {"estagio": -30, "junior": -3, "pleno": 15, "senior": 2, "lead": -15, "indefinido": 5}
    if years < 1:
        return "junior", {"estagio": 5, "junior": 15, "pleno": 0, "senior": -15, "lead": -25, "indefinido": 5}
    if years < 3:
        return "junior", {"estagio": -15, "junior": 12, "pleno": 10, "senior": -8, "lead": -20, "indefinido": 5}
    return "senior", {"estagio": -40, "junior": -20, "pleno": 3, "senior": 15, "lead": 5, "indefinido": 5}


def build_from_text(text: str) -> dict:
    text_n = normalize(text)
    found = []
    for name, patterns, weight, kind, _ in CATALOG:
        hits = sum(len(re.findall(p, text_n)) for p in patterns)
        if hits:
            found.append({"name": name, "weight": weight + min(3, hits - 1), "patterns": patterns, "kind": kind, "hits": hits})
    names = {s["name"] for s in found}
    avoid = [
        {"name": name, "weight": aw, "patterns": patterns}
        for name, patterns, _, _, aw in CATALOG
        if aw and name not in names
    ] + copy.deepcopy(ALWAYS_AVOID)

    kinds = {s["kind"] for s in found}
    years = _years(text_n)
    loc = _location(text)
    english = _english(text_n)
    role = _role(text_n, kinds)
    level, seniority_points = _seniority(years)

    profile = copy.deepcopy(DEFAULT_PROFILE)
    profile["skills"] = [{k: s[k] for k in ("name", "weight", "patterns")} for s in sorted(found, key=lambda s: -s["weight"])]
    profile["avoid"] = avoid
    profile["seniority_points"] = seniority_points
    profile["max_years_ok"] = (years or 3) + 1
    profile["english_fluent_penalty"] = 0 if english in ("avancado", "fluente") else 8
    profile["preferred_locations"] = (
        [normalize(loc[0]), normalize(CAPITAL.get(loc[1], "")), UF[loc[1]], f", {loc[1]}"] if loc else []
    )
    profile["preferred_locations"] = [x for x in profile["preferred_locations"] if x]
    top = [s["name"] for s in sorted(found, key=lambda s: -s["weight"])[:4]]
    role_label = {"fullstack": "Full Stack", "backend": "Back-end", "frontend": "Front-end", "mobile": "Mobile"}[role]
    profile["headline"] = f"Desenvolvedor {role_label}" + (f" · {years}+ anos" if years else "") + (f" · {', '.join(top)}" if top else "")
    profile.pop("name", None)

    summary = {
        "skills": [{"name": s["name"], "hits": s["hits"], "weight": s["weight"]} for s in found],
        "avoid": [a["name"] for a in avoid],
        "years": years,
        "location": f"{loc[0]}, {loc[1].upper()}" if loc else None,
        "english": english,
        "role": role_label,
        "seniority": level,
        "chars": len(text),
    }
    return {"profile": profile, "templates": build_templates(found, role, level, loc, english), "summary": summary}


def _pick(found: list[dict], kind: str, order: list[str]) -> list[str]:
    names = {s["name"] for s in found if s["kind"] == kind}
    return [n for n in order if n in names]


SEARCH_NAME = {"Node.js": "node", "Java": "java", "Go": "golang", "Python": "python", ".NET/C#": ".net", "PHP/Laravel": "php",
               "Ruby": "ruby", "Kotlin": "kotlin", "Elixir": "elixir", "Rust": "rust", "React": "react", "Next.js": "next.js",
               "Angular": "angular", "Vue": "vue"}


def build_templates(found, role, level, loc, english) -> list[dict]:
    backs = _pick(found, "back", ["Node.js", "Java", "Go", "Python", ".NET/C#", "PHP/Laravel", "Ruby", "Kotlin", "Elixir", "Rust"])
    fronts = _pick(found, "front", ["React", "Next.js", "Angular", "Vue"])
    lvl = {"junior": "júnior", "pleno": "pleno", "senior": "sênior"}[level]
    lvl_en = {"junior": "junior", "pleno": "mid-level", "senior": "senior"}[level]
    out = []

    def add(key, name, why, params, overrides=None, region="br"):
        tpl = _t(f"cv-{key}", "Do seu CV", name, why, params, overrides, region=region)
        tpl["builtin"] = False
        tpl["generated"] = True
        out.append(tpl)

    def br(key, label, term, google):
        add(key, f"{label} {lvl.capitalize()} (remoto)", f"Gerado do CV: {label} é o seu foco.", {
            "sites": ["indeed", "linkedin", "google"], "search_term": term, "google_search_term": f"vagas {google} {lvl} remoto",
        }, {"indeed": {"search_term": f"{term} remoto"}})

    b, f = (SEARCH_NAME[backs[0]] if backs else ""), (SEARCH_NAME[fronts[0]] if fronts else "")
    if role == "fullstack" and (b or f):
        br("fullstack", f"Full Stack {' + '.join(x for x in (backs[:1] + fronts[:1]))}", f"desenvolvedor full stack {b} {f}".strip(), f"desenvolvedor full stack {b} {f}".strip())
    for name in backs[:2]:
        br(f"backend-{SEARCH_NAME[name].strip('.')}", f"Back-end {name}", f"desenvolvedor back-end {SEARCH_NAME[name]}", f"desenvolvedor back-end {SEARCH_NAME[name]}")
    if fronts and role in ("fullstack", "frontend"):
        br(f"frontend-{f.strip('.')}", f"Front-end {fronts[0]}", f"desenvolvedor front-end {f}", f"desenvolvedor front-end {f}")
    if loc:
        city = CAPITAL.get(loc[1]) or loc[0]
        add("local", f"{city} / {loc[1].upper()} · Híbrido ou presencial",
            f"Gerado do CV: você mora em {loc[0]} ({loc[1].upper()}); vagas híbridas/presenciais na região.", {
                "sites": ["indeed", "linkedin"], "search_term": "desenvolvedor", "location": f"{city}, {loc[1].upper()}",
                "distance": 100, "is_remote": False, "hours_old": 336,
            })
    if english in ("intermediario", "avancado", "fluente") and (b or f):
        stack = " ".join(x for x in (b, f) if x)
        add("latam", f"LATAM remoto · {' / '.join(backs[:1] + fronts[:1])}",
            "Gerado do CV: inglês " + english + " — empresas dos EUA contratam via LATAM.", {
                "sites": ["linkedin", "google"], "search_term": f"{lvl_en} {'full stack' if role == 'fullstack' else role} engineer {stack}",
                "location": "Latin America", "google_search_term": f"remote {role} developer {stack} latin america",
            }, region="intl")
    return out


def build_from_pdf(data: bytes) -> dict:
    text = pdf_text(data)
    if len(text) < 200:
        raise ValueError("Não consegui extrair texto do PDF (é uma imagem escaneada?).")
    return build_from_text(text)
