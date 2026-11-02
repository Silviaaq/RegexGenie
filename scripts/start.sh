#!/bin/sh
set -eu
cd /app/backend
python manage.py migrate --noinput
python manage.py worker &
worker_pid=$!
gunicorn --bind "0.0.0.0:${PORT:-10000}" --workers 1 --threads 2 --timeout 90 --max-requests 300 --max-requests-jitter 50 wsgi:application &
server_pid=$!
trap 'kill "$server_pid" "$worker_pid" 2>/dev/null || true' TERM INT EXIT
# End the container if either critical process exits, allowing the host to restart it.
while kill -0 "$server_pid" 2>/dev/null && kill -0 "$worker_pid" 2>/dev/null; do sleep 2; done
exit 1
