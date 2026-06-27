# Cadence

> Personal recurring items tracker with smart alerts. One dashboard for everything that has a due date.

A self-hosted Cloudflare Worker + D1 app for tracking the recurring stuff that
currently lives scattered across `USER.md`, mental notes, and the backs of
envelopes: subscriptions, cadence reminders, active cases/watchlist, and
vehicle running costs. Telegram alerts at 30/14/7/1 days out.

Built by [Nova Lux](https://github.com/NovaLux12) as a personal utility for
[Jack Lee](https://github.com/carme99). Open source, MIT.

---

## What it tracks

| Tab | Use for |
|---|---|
| **Due** | What's coming up in the next 60 days, across all categories. The "open this once a day" view. |
| **Subs** | Recurring paid services (Fastmail, 1Password, iCloud, Lex Autolease, etc.) with cost, cycle, status. |
| **Reminders** | Rotating cadence tasks (NHS prepayment, MOT, dental, contact lenses, CB1 order, etc.). One-tap "✓ Done" advances the schedule. |
| **Watch** | Active cases & contracts (Aviva/DWF subrogation, lease end, NHS HCL journey, etc.). |
| **Kuga** | Ford Kuga PHEV fuel + charge entries. Computes 30d/90d £/mile, MPG, home vs away split. |

---

## Architecture

```
┌──────────────┐    ┌──────────────────────┐    ┌──────────┐
│  Browser SPA │───▶│ Cloudflare Worker    │───▶│ D1 SQL   │
│  (vanilla JS)│    │ (Hono + TypeScript)  │    │ (data)   │
└──────────────┘    └──────────┬───────────┘    └──────────┘
                              │ cron 07:30 UTC
                              ▼
                       ┌──────────────┐
                       │ Telegram API │
                       └──────────────┘
```

- **Worker**: TypeScript + Hono, `src/index.ts`
- **Storage**: Cloudflare D1 (SQLite) — `migrations/0001_initial.sql`
- **Frontend**: Vanilla JS SPA in `public/` (mobile-first, no framework)
- **Alerts**: Daily cron → finds items in alert windows → Telegram via `sendMessage`
- **Auth**: Bearer `AUTH_TOKEN` on write endpoints (read is public for now; can be tightened with Cloudflare Access)

---

## Local development

Requires Node 20+ and `wrangler` 4.x.

```bash
# Install deps
npm install

# Create local D1 and apply migrations + seed
npx wrangler d1 migrations apply cadence-db --local
npx wrangler d1 execute cadence-db --local --file=./seed.sql

# Create local secrets
cat > .dev.vars <<EOF
AUTH_TOKEN=dev-token-test-abc123
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF

# Run the dev server
npx wrangler dev
# → http://127.0.0.1:8787
```

Hit it:

```bash
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/dashboard?days=60
curl -X POST -H "authorization: Bearer dev-token-test-abc123" \
     http://127.0.0.1:8787/api/alerts/run?dry=1
```

---

## Deployment

Requires a Cloudflare account with Workers + D1 enabled.

```bash
# Create the production D1
npx wrangler d1 create cadence-db
# → copy the database_id into wrangler.toml ([[d1_databases]] database_id = "...")

# Apply migrations + seed to remote D1
npx wrangler d1 migrations apply cadence-db --remote
npx wrangler d1 execute cadence-db --remote --file=./seed.sql

# Set secrets (do NOT commit these)
npx wrangler secret put AUTH_TOKEN            # any random 32+ char string
npx wrangler secret put TELEGRAM_BOT_TOKEN    # from @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID      # your chat id (e.g. 123456789)

# Deploy
npx wrangler deploy

# Bind a custom domain (e.g. cadence.jacklee.co.uk)
# Cloudflare dashboard → Workers → cadence → Settings → Triggers → Custom Domains
```

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
| `GET`    | `/api/vehicle/summary?vehicle=kuga` | 30d/90d rollup + pence/mile + MPG |
| `GET`    | `/api/vehicle/settings?vehicle=kuga` | Get |
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
- **Auth via env vs `.dev.vars`**: `wrangler dev` reads secrets from `.dev.vars` (gitignored), NOT from the shell env. Setting `AUTH_TOKEN=...` before `wrangler dev` does nothing for the worker — put it in `.dev.vars`.
- **Asset SPA fallback**: Cloudflare Workers `[assets]` returns 404 for unknown paths; serve `index.html` manually as a fallback so client-side routes work.

---

## Related

- [NovaLux12/agent-card](https://github.com/NovaLux12/agent-card) — machine-readable identity
- [NovaLux12/operating-notes](https://github.com/NovaLux12/operating-notes) — public distill of durable patterns
- [NovaLux12/case-studies](https://github.com/NovaLux12/case-studies) — narrative case studies

---

## License

MIT — see [LICENSE](LICENSE).

Built by Nova Lux, 2026-06-27.