"""
Default candidate profile derived from cv-joao-neto-pt.pdf.

Every pattern is a regex matched against the lower-cased, accent-stripped
title + description. Weights are editable from the "Perfil" tab; the edited
version is stored in webapp/data/profile.json and overrides this default.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
PROFILE_PATH = DATA_DIR / "profile.json"

DEFAULT_PROFILE = {
    "name": "João Neto",
    "headline": "Desenvolvedor Full Stack · 3+ anos · Node.js/TypeScript, React/Next.js, Java/Spring, GCP",
    # Skills taken from the CV. Weight ~ how strongly a mention signals a fit.
    "skills": [
        {"name": "TypeScript", "weight": 10, "patterns": [r"typescript", r"\bts\b"]},
        {"name": "Node.js", "weight": 10, "patterns": [r"node\.?js", r"\bnode\b", r"nestjs", r"express"]},
        {"name": "JavaScript", "weight": 5, "patterns": [r"javascript", r"\bjs\b"]},
        {"name": "React", "weight": 8, "patterns": [r"\breact\b", r"react\.?js"]},
        {"name": "Next.js", "weight": 8, "patterns": [r"next\.?js", r"\bnext\b"]},
        {"name": "Fastify", "weight": 6, "patterns": [r"fastify"]},
        {"name": "Java", "weight": 7, "patterns": [r"\bjava\b(?!\s*script)"]},
        {"name": "Spring Boot", "weight": 7, "patterns": [r"spring"]},
        {"name": "Prisma", "weight": 5, "patterns": [r"prisma"]},
        {"name": "GraphQL", "weight": 5, "patterns": [r"graphql"]},
        {"name": "REST APIs", "weight": 3, "patterns": [r"\brest(ful)?\b", r"\bapis?\b"]},
        {"name": "PostgreSQL", "weight": 6, "patterns": [r"postgres"]},
        {"name": "MongoDB", "weight": 4, "patterns": [r"mongo"]},
        {"name": "Redis", "weight": 3, "patterns": [r"\bredis\b"]},
        {"name": "GCP", "weight": 6, "patterns": [r"\bgcp\b", r"google cloud", r"cloud run", r"firebase"]},
        {"name": "AWS", "weight": 4, "patterns": [r"\baws\b", r"amazon web services"]},
        {"name": "Docker", "weight": 5, "patterns": [r"docker", r"container"]},
        {"name": "CI/CD", "weight": 4, "patterns": [r"ci\s*/\s*cd", r"github actions", r"pipeline"]},
        {"name": "Go", "weight": 5, "patterns": [r"\bgolang\b", r"\bgo\s+(developer|engineer|backend|dev)\b", r"\b(em|in|with|com)\s+go\b", r"[,/(]\s*go\s*[,/)]"]},
        {"name": "RabbitMQ", "weight": 3, "patterns": [r"rabbitmq", r"mensageria", r"message (broker|queue)", r"pub\s*/?\s*sub", r"kafka"]},
        {"name": "Testes", "weight": 3, "patterns": [r"testes? (automatizad|de integra|unit)", r"\bjest\b", r"vitest", r"integration test", r"\btdd\b"]},
        {"name": "Clean Arch / SOLID", "weight": 3, "patterns": [r"clean arch", r"\bsolid\b", r"\bddd\b", r"arquitetura limpa"]},
    ],
    # Stacks absent from the CV. Matches in the title weigh much more than in the body,
    # since descriptions often list them only as "nice to have".
    "avoid": [
        {"name": "PHP/Laravel", "weight": 10, "patterns": [r"\bphp\b", r"laravel", r"wordpress"]},
        {"name": ".NET/C#", "weight": 10, "patterns": [r"\.net\b", r"\bc#", r"c sharp", r"dotnet", r"asp\.net"]},
        {"name": "Ruby", "weight": 8, "patterns": [r"\bruby\b", r"\brails\b"]},
        {"name": "Python", "weight": 4, "patterns": [r"\bpython\b", r"django", r"fastapi", r"flask"]},
        {"name": "Angular", "weight": 6, "patterns": [r"angular"]},
        {"name": "Vue", "weight": 5, "patterns": [r"\bvue\b", r"vue\.?js", r"nuxt"]},
        {"name": "Mobile nativo", "weight": 8, "patterns": [r"\bkotlin\b", r"\bswift\b", r"flutter", r"\bandroid\b", r"\bios\b"]},
        {"name": "Delphi/COBOL/legado", "weight": 10, "patterns": [r"delphi", r"cobol", r"\babap\b", r"\bprogress\b", r"genexus", r"oracle forms"]},
        {"name": "Dados/ML", "weight": 6, "patterns": [r"data scien", r"cientista de dados", r"machine learning engineer", r"engenheiro de dados", r"data engineer"]},
        {"name": "QA manual", "weight": 6, "patterns": [r"\bqa\b", r"quality assurance", r"analista de testes"]},
    ],
    # Points added for each detected seniority level (from the title).
    "seniority_points": {
        "estagio": -30,
        "junior": -3,
        "pleno": 15,
        "senior": 2,
        "lead": -15,
        "indefinido": 5,
    },
    "work_mode_points": {"remoto": 10, "hibrido": 0, "presencial": -8, "indefinido": 0},
    # Cities where hybrid/onsite is still fine (CV: Caruaru, PE).
    "preferred_locations": ["caruaru", "recife", "pernambuco", ", pe"],
    "preferred_location_points": 12,
    "english_fluent_penalty": 8,
    "max_years_ok": 4,
    "years_penalty_per_year": 4,
    # Sum of matched skill weights that counts as a "full" stack match.
    "skill_saturation": 35,
}


def load_profile() -> dict:
    if PROFILE_PATH.exists():
        try:
            stored = json.loads(PROFILE_PATH.read_text())
            merged = copy.deepcopy(DEFAULT_PROFILE)
            merged.update(stored)
            return merged
        except (OSError, json.JSONDecodeError):
            pass
    return copy.deepcopy(DEFAULT_PROFILE)


def save_profile(profile: dict) -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_PATH.write_text(json.dumps(profile, ensure_ascii=False, indent=2))
    return profile


def reset_profile() -> dict:
    if PROFILE_PATH.exists():
        PROFILE_PATH.unlink()
    return copy.deepcopy(DEFAULT_PROFILE)
