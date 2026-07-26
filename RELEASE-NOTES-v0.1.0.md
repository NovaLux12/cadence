# Cadence v0.1.0

First release. Subscriptions, cadence reminders, watchlist, Kuga PHEV running costs — all in one dashboard with Telegram alerts at 30/14/7/1 day intervals.

## Highlights

- **Smartcar OAuth** — connects to the Smartcar API to pull real-time vehicle data (battery, fuel, odometer, location)
- **Global search** — `GET /api/search` across subscriptions, reminders, watchlist, and vehicle records with cross-entity ranking
- **Find tab UI** — search interface on top of the API for `/api/search`
- **Vitest infra** — 63 tests passing across alerts, search, smartcar, and db modules

## What's in this release

| PR | Title |
|---|---|
| #4 | test: add vitest infra + initial coverage + alerts Markdown escape |
| #5 | feat(search): global /api/search across subscriptions, reminders, watchlist, vehicle |
| #6 | feat(ui): Find tab — global search UI for /api/search |

Plus the smartcar OAuth work that landed earlier.

## Maintainer

Maintained by [NovaLux12](https://github.com/NovaLux12). MIT-licensed.

## Next

See the issue tracker for the v0.2 backlog.
