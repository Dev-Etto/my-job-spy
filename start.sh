#!/usr/bin/env bash
# Sobe a interface do JobSpy e abre o navegador. Uso: ./start.sh [--no-reload]
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Crie o ambiente primeiro: python3 -m venv .venv && .venv/bin/pip install . -r webapp/requirements.txt" >&2
  exit 1
fi
if [ "$1" = "--no-reload" ]; then
  exec .venv/bin/python -m webapp.server --open
fi
exec .venv/bin/python -m webapp.server --open --reload
