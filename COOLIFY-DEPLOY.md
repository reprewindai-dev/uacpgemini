# Coolify Deployment Guide (barbankz.com)

## 1) Push repo to GitHub and import in Coolify
- Import this repository into Coolify.
- App type: **Docker Compose** (recommended).
- Build source: this repo root.

## 2) Configure build and run
- Build command: automatic via Dockerfile.
- Start command: `npm run start` (from Dockerfile CMD).
- Exposed port: `43000` (far from existing `3000` service ports).

## 3) Set required environment variables
At minimum:

- `OPERATOR_PASSCODE`
- `AUTH_SESSION_SECRET`
- `OLLAMA_BASE_URL`
- `AI_PROVIDER=ollama`
- `LLM_PROVIDER=ollama`
- `AI_FALLBACK_PROVIDER=groq`
- `OLLAMA_MODEL=llama3.1:8b`
- `OLLAMA_AUTOSTART=false`
- `OLLAMA_PULL_ON_BOOT=false`
- `UACP_PUBLIC_DEMO_ENABLED=false`

## 4) Connect your existing Llama
- If your Llama is in Coolify too, make sure it is on the same private network and set:
  - `OLLAMA_BASE_URL=http://ollama:11434`
- If Llama is on the host / another machine, set:
  - `OLLAMA_BASE_URL=http://host.docker.internal:11434`
  - and enable `host.docker.internal` mapping in compose extra hosts.

## 5) Persistence
Option A (recommended): Add managed Postgres and set `DATABASE_URL` to your DB DSN:
- `postgres://USER:PASS@HOST:5432/DB`

Option B: bootstrap now without entering a manual DSN (still free):
- The compose file can start an internal Postgres service automatically.
- In that mode, omit `DATABASE_URL` and the app uses:
  `postgres://barbankz:barbankz_local_password@postgres:5432/barbankz`
- This is isolated to this compose stack and does not touch other apps.

Option C: file mode
- Keep `DATABASE_URL` empty.
- Keep volume mapped: `/app/data` in docker-compose.
- `DATA_FILE_PATH=/app/data/uacp-state.json`

## 6) Domain and HTTPS
- Add domain `barbankz.com` in Coolify and enable HTTPS.
- Keep internal service port `43000` for this app; Coolify handles TLS termination.

### Domain + TLS notes
- Use a dedicated Coolify HTTP(S) domain resource bound to this app:
  - Production domain: `barbankz.com` (and `www.barbankz.com` as needed)
  - Force HTTPS and redirect HTTP -> HTTPS
- Keep internal exposed port: `43000`.
- In app env add `CORS_ALLOWED_ORIGINS=https://barbankz.com,https://www.barbankz.com`

## 7) Validation
- Open `https://barbankz.com`.
- Verify:
  - app loads
  - session login works
  - `/api/bootstrap` returns config JSON
- compile a plan, start a run, see websocket progress updates
- Llama call succeeds (or falls back to configured secondary provider)

### Email capture endpoint
- The landing form now posts to `/api/leads`.
- It accepts `{ "email": "you@domain.com", "source": "homepage_waitlist" }`.
- Set `LEAD_CAPTURE_MAX` to cap stored leads (default 5000).
- `/api/leads` now persists to `lead_captures` table when `DATABASE_URL` is present.
