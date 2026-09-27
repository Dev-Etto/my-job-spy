"""
Derives filterable attributes from a scraped job and scores it against the profile.

Everything here is heuristic regex work on title/location/description: the
scrapers return very uneven data (e.g. Indeed BR rarely has salary, LinkedIn
only has a description when linkedin_fetch_description=True).
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime

_compiled: dict[str, re.Pattern] = {}


def rx(pattern: str) -> re.Pattern:
    if pattern not in _compiled:
        try:
            _compiled[pattern] = re.compile(pattern, re.IGNORECASE)
        except re.error:
            _compiled[pattern] = re.compile(re.escape(pattern), re.IGNORECASE)
    return _compiled[pattern]


def normalize(text: str | None) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", str(text))
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower()


SENIORITY_RULES = [
    ("estagio", r"\b(estagi\w*|intern(ship)?|trainee|aprendiz)\b"),
    ("lead", r"\b(lead|lider|tech\s*lead|staff|principal|head|architect|arquitet[oa]|manager|gerente|coordenador\w*|especialista|specialist)\b"),
    # pleno before senior: "Pleno/Sênior" titles accept the lower level
    ("pleno", r"\b(pleno|pl|mid|middle|mid-level|intermediate|ii)\b"),
    ("senior", r"\b(senior|sr\.?|iii|sen\.)\b"),
    ("junior", r"\b(junior|jr\.?|entry[- ]level|i)\b"),
]

REMOTE_RX = r"remot[oa]|\bremote\b|home\s*office|anywhere|work from home|\bwfh\b|teletrabalho"
HYBRID_RX = r"h[ií]brid[oa]|\bhybrid\b"
FULLY_REMOTE_RX = r"100\s*%\s*(remot|home)|totalmente remot|fully remote|remote[- ]first|trabalho remoto|vaga remota|modelo remoto|regime remoto"
ONSITE_RX = r"presencial|on[- ]?site|in[- ]office|in office"

ENGLISH_FLUENT_RX = [
    r"(ingles|english)\s*(fluente|avancado|fluent|advanced|c1|c2|proficien\w*)",
    r"(fluen\w*|advanced|proficien\w*|excellent|strong)\s+(in\s+|level\s+of\s+)?(spoken\s+|written\s+)?english",
    r"english\s+(fluency|proficiency)",
    r"conversacao em ingles",
]

YEARS_RX = r"(\d{1,2})\s*\+?\s*(?:anos|years|yrs)"
CLT_RX = r"\bclt\b|carteira assinada|regime celetista"
PJ_RX = r"\bpj\b|pessoa juridica|\bcnpj\b"
CONTRACTOR_RX = r"\bcontractor\b|independent contractor|\b1099\b|\bb2b\b"
BRL_RX = r"r\$\s?(\d{1,3}(?:[.\s]\d{3})+|\d{3,6})(?:,\d{2})?"

BR_LOCATION_RX = r"\b(brazil|brasil|br)\b|\b(sp|rj|mg|pe|pr|sc|rs|ba|ce|df|go|es|pb|rn|al|se|pa|am|ma|pi|mt|ms|to|ro|ac|ap|rr)\s*(,|$)"

INTERVAL_TO_MONTH = {
    "yearly": 1 / 12,
    "monthly": 1,
    "weekly": 4.33,
    "daily": 21,
    "hourly": 168,
}

EN_WORDS = re.compile(r"\b(the|and|with|you|will|our|for|experience|team|we)\b")
PT_WORDS = re.compile(r"\b(de|para|com|voce|nossa|nosso|experiencia|equipe|vaga|que)\b")


def detect_seniority(title_n: str) -> str:
    for level, pattern in SENIORITY_RULES:
        if rx(pattern).search(title_n):
            return level
    return "indefinido"


def detect_work_mode(job: dict, title_n: str, loc_n: str, desc_n: str) -> str:
    head = f"{title_n} {loc_n}"
    if rx(HYBRID_RX).search(head):
        return "hibrido"
    if job.get("is_remote") or rx(REMOTE_RX).search(head):
        return "remoto"
    if rx(FULLY_REMOTE_RX).search(desc_n):
        return "remoto"
    if rx(HYBRID_RX).search(desc_n):
        return "hibrido"
    if rx(ONSITE_RX).search(desc_n):
        return "presencial"
    if rx(REMOTE_RX).search(desc_n):
        return "remoto"
    return "indefinido"


def detect_language(desc_n: str) -> str:
    if len(desc_n) < 80:
        return "indefinido"
    en = len(EN_WORDS.findall(desc_n))
    pt = len(PT_WORDS.findall(desc_n))
    return "en" if en > pt * 1.2 else "pt"


def detect_years(desc_n: str) -> int | None:
    values = [int(m.group(1)) for m in rx(YEARS_RX).finditer(desc_n)]
    values = [v for v in values if 1 <= v <= 15]
    return min(values) if values else None


def detect_contract(job: dict, desc_n: str) -> list[str]:
    found = []
    text = f"{normalize(job.get('title'))} {desc_n}"
    if rx(CLT_RX).search(text):
        found.append("CLT")
    if rx(PJ_RX).search(text):
        found.append("PJ")
    if rx(CONTRACTOR_RX).search(text) or "contract" in (job.get("job_type") or ""):
        found.append("Contractor")
    return found


def detect_region(job: dict, loc_n: str, region_hint: str | None) -> str:
    if loc_n:
        return "br" if rx(BR_LOCATION_RX).search(loc_n) else "intl"
    return region_hint or "intl"


def guess_brl_salary(desc: str) -> tuple[float | None, float | None]:
    values = []
    for m in rx(BRL_RX).finditer(desc or ""):
        raw = re.sub(r"[.\s]", "", m.group(1))
        try:
            v = float(raw)
        except ValueError:
            continue
        if 1000 <= v <= 60000:
            values.append(v)
    if not values:
        return None, None
    return min(values), max(values)


def monthly_salary(job: dict) -> tuple[float | None, float | None, str | None, str]:
    """Returns (min, max, currency, source) normalized to a monthly amount."""
    interval = job.get("interval")
    mn, mx = job.get("min_amount"), job.get("max_amount")
    if interval in INTERVAL_TO_MONTH and (mn or mx):
        factor = INTERVAL_TO_MONTH[interval]
        mn = round(mn * factor) if mn else None
        mx = round(mx * factor) if mx else None
        return mn or mx, mx or mn, job.get("currency") or "USD", "informado"
    gmin, gmax = guess_brl_salary(job.get("description") or "")
    if gmin:
        return gmin, gmax, "BRL", "descricao"
    return None, None, None, ""


def days_ago(posted) -> int | None:
    if not posted:
        return None
    try:
        if isinstance(posted, str):
            posted = datetime.fromisoformat(posted[:10]).date()
        if isinstance(posted, datetime):
            posted = posted.date()
        return (date.today() - posted).days
    except (ValueError, TypeError):
        return None


def _matches(entry: dict, text: str) -> bool:
    return any(rx(p).search(text) for p in entry.get("patterns") or [entry["name"]])


def dup_key(job: dict) -> str:
    title = re.sub(r"[^a-z0-9]+", " ", normalize(job.get("title"))).strip()
    company = re.sub(r"[^a-z0-9]+", " ", normalize(job.get("company"))).strip()
    return f"{title}|{company}"


def analyze(job: dict, profile: dict, region_hint: str | None = None) -> dict:
    title_n = normalize(job.get("title"))
    loc_n = normalize(job.get("location"))
    desc_n = normalize(job.get("description"))
    full = f"{title_n}\n{desc_n}"

    seniority = detect_seniority(title_n)
    work_mode = detect_work_mode(job, title_n, loc_n, desc_n)
    language = detect_language(desc_n)
    english_fluent = any(rx(p).search(desc_n) for p in ENGLISH_FLUENT_RX)
    years = detect_years(desc_n)
    contract = detect_contract(job, desc_n)
    region = detect_region(job, loc_n, region_hint)
    sal_min, sal_max, sal_cur, sal_src = monthly_salary(job)

    matched, matched_title, skill_points = [], [], 0.0
    for skill in profile["skills"]:
        if _matches(skill, full):
            matched.append(skill["name"])
            weight = float(skill.get("weight", 0))
            if _matches(skill, title_n):
                matched_title.append(skill["name"])
                weight *= 1.5
            skill_points += weight

    avoid_hits, avoid_title_hits, avoid_points = [], [], 0.0
    for stack in profile["avoid"]:
        weight = float(stack.get("weight", 0))
        if _matches(stack, title_n):
            avoid_hits.append(stack["name"])
            avoid_title_hits.append(stack["name"])
            avoid_points += weight * 4
        elif _matches(stack, desc_n):
            avoid_hits.append(stack["name"])
            avoid_points += weight * 0.4

    saturation = float(profile.get("skill_saturation") or 35)
    breakdown = {
        "base": 15,
        "stack": round(min(1.0, skill_points / saturation) * 55, 1),
        "fora_do_cv": -round(min(avoid_points, 40), 1),
        "senioridade": profile["seniority_points"].get(seniority, 0),
        "modalidade": profile["work_mode_points"].get(work_mode, 0),
    }
    if work_mode != "remoto" and any(p in loc_n for p in profile.get("preferred_locations", [])):
        breakdown["localizacao"] = profile.get("preferred_location_points", 0)
    if english_fluent:
        breakdown["ingles_fluente"] = -profile.get("english_fluent_penalty", 0)
    if years and years > profile.get("max_years_ok", 4):
        breakdown["anos_exigidos"] = -min(
            20, (years - profile["max_years_ok"]) * profile.get("years_penalty_per_year", 4)
        )
    if not desc_n:
        # no description (LinkedIn without fetch): only the title is known, don't punish
        breakdown["sem_descricao"] = 8 if matched_title else 0

    score = max(0, min(100, round(sum(breakdown.values()))))

    return {
        "seniority": seniority,
        "work_mode": work_mode,
        "language": language,
        "english_fluent": english_fluent,
        "years_required": years,
        "contract": contract,
        "region": region,
        "salary_month_min": sal_min,
        "salary_month_max": sal_max,
        "salary_currency": sal_cur,
        "salary_source": sal_src,
        "matched_skills": matched,
        "matched_title_skills": matched_title,
        "avoid_hits": avoid_hits,
        "avoid_title_hits": avoid_title_hits,
        "score": score,
        "score_breakdown": breakdown,
        "dup_key": dup_key(job),
    }
