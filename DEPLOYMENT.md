# Deploying Riva Teacher on Railway

This guide covers deploying the [rivatutor](https://github.com/deepesh-crowstone/rivatutor) Next.js app to [Railway](https://railway.com) from GitHub.

## Prerequisites

- GitHub repo pushed and up to date
- Railway account
- API keys: [OpenRouter](https://openrouter.ai), [ElevenLabs](https://elevenlabs.io) (required for STT)
- Optional: Google AI / Vertex API key if using `TTS_PROVIDER=vertex`

## Quick start

1. **Create a Railway project** → **Deploy from GitHub repo** → select `deepesh-crowstone/rivatutor`.
2. **Add PostgreSQL** (recommended) — see [Database setup](#database-setup) below.
3. **Set environment variables** — see [Environment variables](#environment-variables).
4. **Deploy** — Railway runs `npm run build` and starts with `npm start`. Prisma schema is applied on each deploy via `releaseCommand` in `railway.toml`.
5. **Open the app** — use the generated `*.up.railway.app` URL or attach a [custom domain](#custom-domain-optional).

---

## Database setup

### Recommended: Railway PostgreSQL

Railway’s filesystem is **ephemeral** — a local SQLite file (`dev.db`) is **lost on every redeploy and restart**. For any shared or persistent POC, use PostgreSQL.

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**.
2. On the **web service** (not only the Postgres service), set:

   ```text
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

   Use the **Variable Reference** picker in Railway → **Variables** so the web service receives the Postgres connection string. Do **not** leave `DATABASE_URL=file:./dev.db` from local dev — that creates an empty ephemeral SQLite file and causes errors like `The table main.LearnerProfile does not exist`.

3. On deploy, `releaseCommand` and `scripts/startup.mjs` both run `prisma db push` against that URL. The app auto-selects the PostgreSQL Prisma schema when `DATABASE_URL` starts with `postgres://` or `postgresql://`, or when running on Railway without the local SQLite default.

No manual migration step is required for this POC (the project uses `db push`, not migration files).

### Alternative: SQLite with a Railway Volume (POC only)

If you want to stay on SQLite for a quick demo:

1. Add a **Volume** mounted at `/data` on the web service.
2. Set `DATABASE_URL=file:/data/riva.db`.
3. Understand limitations:
   - Data persists only while the volume and service exist.
   - Not ideal for production or multi-instance scaling.
   - `better-sqlite3` is a native module; Nixpacks builds it on deploy (first build may take longer).

**Default local dev** still uses `file:./dev.db` (SQLite). Production on Railway should use PostgreSQL.

---

## Environment variables

Copy from `.env.example` and set these in Railway → your service → **Variables**.

### Required

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM chat |
| `ELEVENLABS_API_KEY` | ElevenLabs key (always used for speech-to-text) |
| `DATABASE_URL` | **Required on web service:** `${{Postgres.DATABASE_URL}}` (recommended). Do not use `file:./dev.db` on Railway. |

### Recommended for production

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_SITE_URL` | `http://localhost:3000` | Your public Railway URL (e.g. `https://rivatutor.up.railway.app`). **Optional:** if unset or still `localhost`, the app derives `https://<request-host>` from Railway proxy headers for OpenRouter `HTTP-Referer`. |
| `OPENROUTER_APP_TITLE` | `Riva Teacher POC` | App name sent to OpenRouter |
| `TTS_PROVIDER` | `openrouter` | `openrouter`, `vertex`, or `elevenlabs` |

### Text-to-speech (by provider)

**OpenRouter TTS** (`TTS_PROVIDER=openrouter`, default):

| Variable | Default |
|----------|---------|
| `OPENROUTER_TTS_MODEL` | `google/gemini-3.1-flash-tts-preview` |
| `OPENROUTER_TTS_VOICE` | `Kore` |
| `OPENROUTER_TTS_VOICE_PROMPT` | Friendly teacher / subtle Indian accent prompt |

**Vertex / Gemini TTS** (`TTS_PROVIDER=vertex`):

| Variable | Default |
|----------|---------|
| `VERTEX_API_KEY` | *(required when using vertex)* |
| `VERTEX_TTS_MODEL` | `gemini-3.1-flash-tts-preview` |
| `VERTEX_TTS_VOICE` | `Kore` |
| `VERTEX_TTS_VOICE_PROMPT` | Same style prompt as OpenRouter |

**ElevenLabs TTS** (`TTS_PROVIDER=elevenlabs`):

| Variable | Default |
|----------|---------|
| `ELEVENLABS_VOICE_ID` | `21m00Tcm4TlvDq8ikWAM` |
| `ELEVENLABS_TTS_MODEL` | `eleven_multilingual_v2` |
| `ELEVENLABS_TTS_OUTPUT_FORMAT` | `mp3_44100_128` |

### Speech-to-text (always ElevenLabs)

| Variable | Default |
|----------|---------|
| `ELEVENLABS_STT_MODEL` | `scribe_v2` |
| `ELEVENLABS_STT_LANGUAGE` | `eng` |

### Railway-provided

| Variable | Description |
|----------|-------------|
| `PORT` | Set automatically by Railway; Next.js `next start` reads it |

Do **not** commit `.env` to git. Use Railway Variables only.

---

## Build and deploy settings

Railway detects Next.js via Nixpacks. This repo includes `railway.toml`:

| Phase | Command |
|-------|---------|
| **Install** | `npm install` → `postinstall` runs `prepare-database` + `prisma generate` |
| **Build** | `npm run build` → selects DB schema (reads `.env` + Railway env), generates Prisma client, `next build` |
| **Release** | `node scripts/prepare-database.mjs && npx prisma db push` |
| **Start** | `npm start` → `scripts/startup.mjs` logs provider/DB URL, runs `db push` again (idempotent), then `next start` |
| **Health** | `GET /api/health` — returns `{ ok, provider, database }`; configured as Railway health check |

Node.js **20+** is required (`engines` in `package.json`). `railway.toml` sets `NIXPACKS_NODE_VERSION=20` and `PRISMA_PROVIDER=postgresql` so the build generates a PostgreSQL Prisma client even before `DATABASE_URL` is linked.

### Manual redeploy

Push to the connected GitHub branch, or click **Deploy** in Railway.

### Verify locally (production build)

Simulate Railway (no secrets required at build time):

```bash
rm -rf .next generated node_modules
npm ci
env -i PATH="$PATH" HOME="$HOME" RAILWAY_ENVIRONMENT=production PRISMA_PROVIDER=postgresql npm run build
npm start
```

With API keys for full runtime:

```bash
cp .env.example .env   # fill in keys
npm install
npm run build
npm start
```

---

## Custom domain (optional)

1. Railway project → web service → **Settings** → **Networking** → **Custom Domain**.
2. Add your domain and configure DNS per Railway’s instructions.
3. Update `OPENROUTER_SITE_URL` to `https://your-domain.com`.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `The table main.LearnerProfile does not exist` | Web service is using SQLite (`file:./dev.db`) instead of Postgres. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the **web** service, redeploy, and check deploy logs for `[startup] Applying Prisma schema`. |
| Build fails on `better-sqlite3` | Prefer PostgreSQL on Railway; or retry deploy (Nixpacks needs native build tools). |
| Build fails with Prisma adapter/provider mismatch | Ensure `prepare-database` and runtime use the same provider. On Railway, `PRISMA_PROVIDER=postgresql` is set in `railway.toml`. Locally, set `DATABASE_URL` in `.env` before `npm run build`, or export `PRISMA_PROVIDER`. |
| `OPENROUTER_API_KEY is required` | Set the variable in Railway and redeploy. This should only appear at **runtime** in API routes, not during `next build`. |
| `ELEVENLABS_API_KEY is required` | Set the variable in Railway and redeploy. |
| Data disappears after deploy | You’re on ephemeral SQLite without a volume — switch to PostgreSQL. |
| Prisma / DB errors on start | Ensure `DATABASE_URL` is set and Postgres service is running; check **Deploy Logs** for `releaseCommand` output. |
| 502 / app not listening | Confirm `startCommand` is `npm start` and `PORT` is not overridden incorrectly. |
| Voice / TTS silent in browser | Open DevTools → **Network** → filter `tts`. A `400` with `Insufficient credits` means add credits at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits). `200` + `audio/L16` = PCM stream; `audio/mpeg` = MP3 fallback. Check console for `[riva-tts]` warnings. |
| TTS works locally but not on Railway | Ensure `OPENROUTER_API_KEY` is set on Railway (not only in local `.env`). Set `OPENROUTER_SITE_URL` to your public URL or rely on auto-derived host headers. |

---

## Files added for Railway

- `railway.toml` — build, release, start commands, and `/api/health` health check
- `scripts/prepare-database.mjs` — picks SQLite vs PostgreSQL Prisma schema from `DATABASE_URL`
- `scripts/startup.mjs` — startup logs, idempotent `db push`, then `next start`
- `prisma/schema.sqlite.prisma` / `prisma/schema.postgresql.prisma` — provider-specific schemas
- `lib/db.ts` — uses SQLite or PostgreSQL driver adapter based on `DATABASE_URL`

After committing these changes, push to GitHub and connect or redeploy on Railway.
