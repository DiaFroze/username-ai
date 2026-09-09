# Username AI — Railway Staging Deployment Runbook

**Project:** Username AI Platform (2.0)  
**Infrastructure Target:** [Railway.com](https://railway.com)  
**Target Environment:** Staging  
**Architecture:** Monorepo with Isolated Multi-Service Orchestration  

---

## 1. High-Level Architecture Overview

```
                          ┌────────────────────────┐
                          │   End User / Telegram  │
                          └──────────┬─────────────┘
                                     │ HTTPS
                   ┌─────────────────┴─────────────────┐
                   ▼                                   ▼
         ┌───────────────────┐               ┌───────────────────┐
         │      miniapp      │               │        api        │
         │ (Nginx / Vite SPA)│ ──REST API──> │ (Fastify Backend) │
         │   [Public HTTPS]  │               │   [Public HTTPS]  │
         └───────────────────┘               └─────────┬─────────┘
                                                       │
                                      Railway Private  │  Railway Private
                                      IPv6 Network     │  IPv6 Network
                                                       │
                                ┌──────────────────────┼──────────────────────┐
                                ▼                      ▼                      ▼
                     ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
                     │     Postgres      │  │       Redis       │  │        bot        │
                     │ (Railway Managed) │  │ (Railway Managed) │  │  (grammY Worker)  │
                     │ [Private Network] │  │ [Private Network] │  │ [Private Network] │
                     └───────────────────┘  └───────────────────┘  └───────────────────┘
```

### Key Principles
1. **No Docker Compose inside Railway:** Each component (`Postgres`, `Redis`, `api`, `bot`, `miniapp`) is an independent Railway service.
2. **Private Databases:** `Postgres` and `Redis` have **NO Public Networking** enabled. Communication occurs strictly over Railway's internal network via reference variables (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`).
3. **Internal Bot Networking:** The Telegram bot runs long polling as a background worker (no public domain needed). It connects to the API over internal private DNS (`http://api.railway.internal:3000`).
4. **Monorepo Build Context:** All services build with Docker context at the **repository root (`/`)** so that shared workspaces (`packages/shared`, `packages/db`, `packages/checker-engine`, `packages/ai-engine`) resolve seamlessly.

---

## 2. Step-by-Step Staging Deployment Protocol

### Step 1: Create a Private GitHub Repository
1. Log in to [GitHub](https://github.com).
2. Click **New repository** (or navigate to `https://github.com/new`).
3. Set **Repository name:** `username-ai` (or `username-ai-platform`).
4. Set visibility to **PRIVATE** (🔒 *Critical: Never make this repository public*).
5. Do **NOT** initialize with a README, .gitignore, or license (the local repository already contains them).
6. Copy the repository URL (e.g. `https://github.com/<your-username>/username-ai.git`).

---

### Step 2: Create a New Project on Railway
1. Open the [Railway Dashboard](https://railway.com/dashboard).
2. Click **+ New Project**.
3. Select **Deploy from GitHub repo**.
4. Choose your newly created private `username-ai` repository.
5. Railway will initially create a service from the repo. (We will configure this as `api` in Step 5).

---

### Step 3: Add PostgreSQL Database Service
1. In your Railway project canvas, click **+ Create** (or press `Ctrl/Cmd + K` -> **Database**).
2. Select **Add PostgreSQL**.
3. Railway provisions a managed PostgreSQL 16 database.
4. Name the service: `Postgres` (default).
5. **Security Check:** In **Settings → Networking**, ensure **Public Networking** is **OFF**.

---

### Step 4: Add Redis In-Memory Store Service
1. In your project canvas, click **+ Create** -> **Database**.
2. Select **Add Redis**.
3. Railway provisions a managed Redis 7 instance.
4. Name the service: `Redis` (default).
5. **Security Check:** In **Settings → Networking**, ensure **Public Networking** is **OFF**.

---

### Step 5: Configure the API Service (`api`)
1. Click on the service connected to your GitHub repository (rename it to `api` in **Settings → General → Service Name**).
2. In **Settings → Source**:
   - **Root Directory:** Leave as `/` (repository root).
3. In **Settings → Build**:
   - **Builder:** Select `Dockerfile`.
   - **Dockerfile Path:** `apps/api/Dockerfile` (or set Config as Code path to `apps/api/railway.json`).
4. In **Settings → Deploy**:
   - **Pre-deploy Command:** `node packages/db/dist/migrate.js`
   - **Healthcheck Path:** `/health/live`
   - **Restart Policy:** `On Failure` (Max retries: 5).

---

### Step 6: Add the Telegram Bot Service (`bot`)
1. In the project canvas, click **+ Create** -> **GitHub Repo**.
2. Select the same `username-ai` repository.
3. Rename the newly created service to `bot`.
4. In **Settings → Source**:
   - **Root Directory:** Leave as `/`.
5. In **Settings → Build**:
   - **Builder:** Select `Dockerfile`.
   - **Dockerfile Path:** `apps/bot/Dockerfile` (or set Config as Code to `apps/bot/railway.json`).
6. In **Settings → Deploy**:
   - **Restart Policy:** `On Failure` (Max retries: 5).
   - *(Note: No Healthcheck Path or Public Domain needed for long-polling bot).*

---

### Step 7: Add the Telegram Mini App Service (`miniapp`)
1. In the project canvas, click **+ Create** -> **GitHub Repo**.
2. Select the same `username-ai` repository.
3. Rename the newly created service to `miniapp`.
4. In **Settings → Source**:
   - **Root Directory:** Leave as `/`.
5. In **Settings → Build**:
   - **Builder:** Select `Dockerfile`.
   - **Dockerfile Path:** `apps/miniapp/Dockerfile` (or set Config as Code to `apps/miniapp/railway.json`).
6. In **Settings → Deploy**:
   - **Healthcheck Path:** `/healthz`
   - **Restart Policy:** `On Failure`.

---

### Step 8: Configure Reference Variables for `api`
In the `api` service **Variables** tab, switch to the **RAW Editor** and paste:

```env
NODE_ENV=staging
PORT=3000
HOST=0.0.0.0

# Reference Variables from Railway Managed Databases
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Security & Tokens
JWT_SECRET=staging-super-secret-jwt-key-minimum-32-chars-high-entropy!
INTERNAL_ADMIN_TOKEN=staging-internal-admin-metrics-token-999
STAGING_TEST_KEY=staging-test-secret-key-12345

# AI Configuration (OpenAI live + resilient mock fallback)
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
AI_FALLBACK_PROVIDER=mock
AI_FALLBACK_MODEL=mock-fallback
AI_TIMEOUT_MS=8000
AI_CACHE_TTL_SECONDS=14400
OPENAI_API_KEY=sk-...

# Rate Limiting Policies
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_CHECK_MAX=30
RATE_LIMIT_NAMING_MAX=10
RATE_LIMIT_DEFAULT_MAX=120

# Watchlist Engine
WATCHLIST_ABSOLUTE_MIN_INTERVAL_MINUTES=60
WATCHLIST_CONCURRENCY=5
```

---

### Step 9: Generate Public Domain for `api`
1. Go to `api` service **Settings → Networking → Public Networking**.
2. Click **Generate Domain**.
3. Railway assigns an automatic HTTPS address (e.g. `api-staging-production-xxxx.up.railway.app`).
4. Copy this domain URL.

---

### Step 10: Generate Public Domain for `miniapp`
1. Go to `miniapp` service **Settings → Networking → Public Networking**.
2. Click **Generate Domain**.
3. Railway assigns an automatic HTTPS address (e.g. `miniapp-staging-production-yyyy.up.railway.app`).
4. Copy this domain URL.

---

### Step 11: Configure Build-Time Variables for `miniapp`
In the `miniapp` service **Variables** tab, add:
```env
VITE_API_URL=https://<your-api-generated-domain>.up.railway.app
```
*(Railway injects this into the `ARG VITE_API_URL` during `npm run build` in the Dockerfile).*

---

### Step 12: Configure CORS Origins on `api`
Back in `api` service **Variables**, add/update `CORS_ALLOWED_ORIGINS`:
```env
CORS_ALLOWED_ORIGINS=https://<your-miniapp-generated-domain>.up.railway.app,https://web.telegram.org
```

---

### Step 13: Create Staging Telegram Bot & Configure `bot` Variables
1. In Telegram, message `@BotFather`.
2. Send `/newbot`.
3. Name: `Username AI Staging`.
4. Handle: `UsernameAiStagingBot` (or unique variant).
5. Copy the HTTP API token.
6. In `bot` service **Variables**, add:
   ```env
   NODE_ENV=staging
   TELEGRAM_BOT_TOKEN=<your-bot-token-from-botfather>
   TELEGRAM_MINIAPP_URL=https://<your-miniapp-generated-domain>.up.railway.app
   API_URL=http://api.railway.internal:3000
   ```
7. Also add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_MINIAPP_URL` to the `api` service **Variables** so `NotificationService` can dispatch notifications.

---

### Step 14: Configure Bot Menu Button in @BotFather
1. In `@BotFather`, send `/mybots`.
2. Select your staging bot.
3. Go to **Bot Settings → Menu Button → Configure menu button**.
4. Send the Mini App URL: `https://<your-miniapp-generated-domain>.up.railway.app`.
5. Enter button title: `🚀 Open Username AI`.

---

### Step 15: Run Database Migrations (Automated via Pre-Deploy)
Because `apps/api/railway.json` includes:
```json
"preDeployCommand": "node packages/db/dist/migrate.js"
```
Railway will automatically spin up an ephemeral container on every deployment, run the SHA-256 verified migration ledger, and apply `0000_initial.sql`, `0001_watchlist.sql`, and `0002_watchlist_integrity.sql`.

*Manual trigger option if needed:*
In Railway dashboard, open the `api` service **Deployments** tab -> **Deployments menu** -> or run via Railway CLI: `railway run npm run db:migrate`.

---

### Step 16: Live Verification Protocol

#### 1. API Liveness & Readiness Verification
```bash
# Public liveness probe (must return 200)
curl -i https://<api-domain>.up.railway.app/health/live

# Sanitized public status (must return 200 without exposing topology)
curl -i https://<api-domain>.up.railway.app/health

# Internal diagnostics (with token)
curl -i -H "X-Internal-Token: staging-internal-admin-metrics-token-999" \
  https://<api-domain>.up.railway.app/health
```
*Expected output for internal diagnostics:*
- `postgres.status: "UP"`
- `redis.status: "UP"`
- `queue.status: "UP"`
- `aiEngine.status: "UP"`

#### 2. Mini App Health Verification
```bash
curl -i https://<miniapp-domain>.up.railway.app/healthz
# Expected output: 200 OK, "healthy"
```

#### 3. Controlled Telegram Notification Test
```bash
curl -i -X POST https://<api-domain>.up.railway.app/api/v1/staging/test-notification \
  -H "Content-Type: application/json" \
  -H "X-Staging-Key: staging-test-secret-key-12345" \
  -d '{"telegramId": <your-personal-telegram-id>, "target": "railway_demo", "platform": "telegram"}'
```
*Verification:* Your personal Telegram account receives an instant MarkdownV2 notification from `@UsernameAiStagingBot`.

#### 4. End-to-End Mini App Test
1. Open `@UsernameAiStagingBot` in Telegram.
2. Tap the menu button **🚀 Open Username AI**.
3. Run an AI generation query (e.g. `quick nova`).
4. Verify Brand Score breakdown renders.
5. Add a candidate to Watchlist.
6. Check that `/watchlist` tab reflects the item.

---

## 3. Cost & Resource Safety Summary

- **Postgres:** 1 replica (Railway Starter/Developer plan).
- **Redis:** 1 replica (No HA, zero unnecessary cost).
- **API:** 1 container (512MB–1GB RAM).
- **Bot:** 1 worker container (256MB–512MB RAM).
- **MiniApp:** 1 Nginx static container (128MB–256MB RAM).
- **Total estimated staging cost:** Fits within standard Railway developer usage tier ($5/month base credits + usage).
