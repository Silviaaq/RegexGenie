#!/bin/sh
set -eu
cd /app/backend
python manage.py migrate --noinput
python manage.py cleanup --loop &
cleanup_pid=$!
# Single worker keeps the in-process request limiter consistent.
gunicorn --bind "0.0.0.0:${PORT:-10000}" --workers 1 --threads 2 --timeout 90 --max-requests 300 --max-requests-jitter 50 wsgi:application &
server_pid=$!
trap 'kill "$server_pid" "$cleanup_pid" 2>/dev/null || true' TERM INT EXIT
wait "$server_pid"
