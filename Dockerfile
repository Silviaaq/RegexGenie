FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY frontend ./frontend
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_DEBUG=0 DATABASE_PATH=/tmp/regexgenie.sqlite3 WORKSPACE_DIR=/tmp/regexgenie-workspaces
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt && useradd --create-home app
COPY backend ./backend
COPY scripts/start.sh ./scripts/start.sh
COPY --from=frontend /build/dist ./dist
USER app
EXPOSE 10000
CMD ["sh", "scripts/start.sh"]
