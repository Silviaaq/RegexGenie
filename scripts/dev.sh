#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f backend/.env ]; then
  echo 'Create backend/.env from backend/.env.example first.'
  exit 1
fi
set -a
. ./backend/.env
set +a
python_bin="${REGEXGENIE_PYTHON:-.venv/bin/python}"
npm run build
cd backend
"../$python_bin" manage.py migrate --noinput
"../$python_bin" manage.py worker &
worker_pid=$!
"../$python_bin" manage.py runserver "127.0.0.1:${PORT:-8019}" --noreload &
server_pid=$!
trap 'kill "$server_pid" "$worker_pid" 2>/dev/null || true' TERM INT EXIT
wait "$server_pid"
