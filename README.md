# Cadence

> Personal recurring items tracker with smart alerts. One dashboard for everything that has a due date.

A self-hosted Cloudflare Worker + D1 app for tracking the recurring stuff
that has a due date — subscriptions, cadence reminders, active cases and
watchlist items, and per-vehicle running costs. Optional Telegram alerts
at 30/14/7/1 days out.

Built by [Nova Lux](https://github.com/NovaLux12). Open source, MIT.

---

## What it tracks

| Tab | Use for |
|---|---|
| **Due** | What's coming up in the next 60 days, across all categories. The "open this once a day" view. |
| **Subs** | Recurring paid services (cloud, email, storage, leases, etc.) with cost, cycle, status. |
| **Reminders** | Rotating cadence tasks (annual renewals, quarterly maintenance, etc.). One-tap "✓ Done" advances the schedule. |
| **Watch** | Active cases, contracts, and decisions awaiting action. |
| **Vehicle** | Fuel + charge entries. Computes 30d/90d £/mile, MPG, home vs away split. |

---

## Architecture

```
┌──────────────┐    ┌──────────────────────┐    ┌──────────┐
│  Browser SPA │───▶│ Cloudflare Worker    │───▶│ D1 SQL   │
│  (vanilla JS)│    │ (Hono + TypeScript)  │    │ (data)   │
└──────────────┘    └──────────┬───────────┘    └──────────┘
                              │ cron (configurable)
                              ▼
                       ┌──────────────┐
                       │ Telegram API │  (optional)
                       └──────────────┘
```

- **Worker**: TypeScript + Hono, `src/index.ts`
- **Storage**: Cloudflare D1 (SQLite) — `migrations/0001_initial.sql`
- **Frontend**: Vanilla JS SPA in `public/` (mobile-first, no framework)
- **Alerts**: Cron → finds items in alert windows → Telegram via `sendMessage`
- **Auth**: Bearer `AUTH_TOKEN` on write endpoints (read is public by default; can be tightened with Cloudflare Access)

---

## Local development

Requires Node 20+ and `wrangler` 4.x.

```bash
# Install deps
npm install

# Create local D1 and apply migrations + demo seed
npx wrangler d1 migrations apply cadence-db --local
npx wrangler d1 execute cadence-db --local --file=./seed.sql

# Create local secrets (not committed)
cat > .dev.vars <<EOF
AUTH_TOKEN=***
TELEGRAM_BOT_TOKEN=
***
EOF

# Run the dev server
npx wrangler dev
# → http://127.0.0.1:8787
```

Hit it:

```bash
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/dashboard?days=60
curl -X POST -H "authorization: Bearer dev-to…c123" \
     http://127.0.0.1:8787/api/alerts/run?dry=1
```

The included `seed.sql` ships with placeholder items so the dashboard
isn't empty on first boot. Replace them via the UI once you've
deployed.

---

## Deployment

Requires a Cloudflare account with Workers + D1 enabled.

```bash
# Create the production D1
npx wrangler d1 create cadence-db
# → copy the database_id into wrangler.toml ([[d1_databases]] database_id = "...")

# Apply migrations + demo seed to remote D1
npx wrangler d1 migrations apply cadence-db --remote
npx wrangler d1 execute cadence-db --remote --file=./seed.sql

# Set secrets (do NOT commit these)
npx wrangler secret put AUTH_TOKEN            # any random 32+ char string
npx wrangler secret put TELEGRAM_BOT_TOKEN    # from @BotFather (optional)
npx wrangler secret put TELEGRAM_CHAT_ID      # your chat id (optional)

# Deploy
npx wrangler deploy

# Bind a custom domain (e.g. cadence.example.com)
# Cloudflare dashboard → Workers → cadence → Settings → Triggers → Custom Domains
```

The repo also ships with a one-shot script (`scripts/deploy.sh`) that
handles D1 create + migrate + seed + secrets + deploy in order. See
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) for a
GitHub Actions auto-deploy on push to `master`.

---

## API

Read endpoints are public. Write endpoints require `Authorization: Bearer $AUTH_TOKEN`.

| Method | Path | Notes |
|---|---|---|
| `GET`    | `/api/health` | Liveness |
| `GET`    | `/api/meta` | App meta + telegram configured flag |
| `GET`    | `/api/dashboard?days=60` | Upcoming items across all kinds |
| `GET`    | `/api/subscriptions` / `/api/subscriptions/:id` | List / get |
| `POST`   | `/api/subscriptions` | Create |
| `PATCH`  | `/api/subscriptions/:id` | Update |
| `DELETE` | `/api/subscriptions/:id` | Delete |
| `GET`    | `/api/reminders` / `/api/reminders/:id` | List / get |
| `POST`   | `/api/reminders` | Create |
| `PATCH`  | `/api/reminders/:id` | Update |
| `POST`   | `/api/reminders/:id/done` | Mark done; advances `next_due` by cadence |
| `DELETE` | `/api/reminders/:id` | Delete |
| `GET`    | `/api/watchlist` / `/api/watchlist/:id` | List / get |
| `POST`   | `/api/watchlist` | Create |
| `PATCH`  | `/api/watchlist/:id` | Update |
| `DELETE` | `/api/watchlist/:id` | Delete |
| `GET`    | `/api/vehicle/entries` | List (filter by vehicle, since, until, type) |
| `POST`   | `/api/vehicle/entries` | Create |
| `DELETE` | `/api/vehicle/entries/:id` | Delete |
| `GET`    | `/api/vehicle/summary?vehicle=mycar` | 30d/90d rollup + pence/mile + MPG |
| `GET`    | `/api/vehicle/settings?vehicle=mycar` | Get |
| `PUT`    | `/api/vehicle/settings` | Upsert |
| `POST`   | `/api/alerts/run?days=60&dry=1` | Manual alert dispatch (dry-run or send) |
| `POST`   | `/api/alerts/test` | Send a single test message to Telegram |

---

## Data model

Five tables:

- `subscriptions` — name, vendor, cost, billing_cycle, next_due_date, status, alert_windows, notes
- `reminders` — title, cadence_value/unit, last_done, next_due, alert_windows, notes
- `watchlist` — title, category, status, next_action_date, next_action_label, parties, notes
- `vehicle_entries` — entry_type (fuel/charge), date, odometer, kwh/litres, cost_pence, is_home_charge
- `vehicle_settings` — per-vehicle constants (odo, battery, electricity rate)
- `alert_log` — idempotency guard: `item_kind + item_id + window_days + date(sent_at)` is unique per day

`alert_windows` is a CSV of days-before-due to alert (default `30,14,7,1`).
Each item matches any of its windows when `days_until <= window_days`.

`next_due` on reminders is computed: `last_done + cadence_value * cadence_unit`.
Marking done advances it.

---

## Configuration

| Var | Required | Notes |
|---|---|---|
| `AUTH_TOKEN` | yes (writes) | Bearer token for write endpoints |
| `TELEGRAM_BOT_TOKEN` | for alerts | From @BotFather |
| `TELEGRAM_CHAT_ID` | for alerts | Numeric chat id (user or group) |
| `APP_URL` | no | Used for alert message footer |

---

## Lessons learned (filed 2026-06-27)

- **SQLite UNION + ORDER BY**: wrap the union in a subquery `SELECT * FROM (...) ORDER BY ...` — SQLite refuses column-references in outer ORDER BY against a UNION because of strict type/column-naming rules. The symptom is a confusing "1st ORDER BY term does not match any column in the result set" error.
- **Auth via env vs `.dev.vars`**: `wrangler dev` reads secrets from `.dev.vars` (gitignored), NOT from the shell env. Setting `AUTH_TOKEN=*** before `wrangler dev` does nothing for the worker — put it in `.dev.vars`.
- **Asset SPA fallback**: Cloudflare Workers `[assets]` returns 404 for unknown paths; use `not_found_handling = "single-page-application"` in `[assets]` so the platform serves `index.html` automatically. (An older alternative is a manual fallback in the Worker's fetch handler.)

---

## License

MIT — see [LICENSE](LICENSE).

Built by Nova Lux, 2026-06-27.