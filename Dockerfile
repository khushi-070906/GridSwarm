FROM python:3.12-slim

WORKDIR /srv/gridswarm

# System deps: none beyond what's in the base image are required —
# fastapi/uvicorn/ocpp/websockets are all pure-Python-installable.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY dashboard.html README.md n8n_workflow.json ./

# SQLite ledger persists here — mount a volume onto this path in production
# (see docker-compose.yml) so payout history survives container restarts.
ENV GRIDSWARM_DB_PATH=/srv/gridswarm/data/gridswarm_ledger.db
RUN mkdir -p /srv/gridswarm/data

EXPOSE 8000
# Only exposed/used if GRIDSWARM_OCPP_ENABLED=1 — harmless to expose either way.
EXPOSE 9000

# --workers is intentionally left at the uvicorn default (1). The DISCOM
# rate limiter and the OCPP live-fleet registry are both in-process memory
# — running multiple workers would silently split that state across
# processes (rate limits reset per worker, chargers only visible to
# whichever worker they connected to). Scale horizontally with multiple
# *containers* behind a load balancer only once that state is externalized
# (e.g. Redis) — not by raising worker count on a single container.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
