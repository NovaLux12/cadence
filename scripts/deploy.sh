#!/usr/bin/env bash
# Cadence — manual deploy script
# Run this from the repo root on a machine with wrangler auth.
#
# What this does:
#   1. Creates the D1 database (idempotent — skips if it exists)
#   2. Applies migrations + seed data to the remote D1
#   3. Sets required secrets on the Worker
#   4. Deploys the Worker
#   5. Prints the URL
#
# Requirements:
#   - wrangler 4.x (npm install -g wrangler@4)
#   - A Cloudflare account with Workers + D1 enabled
#   - CLOUDFLARE_API_TOKEN env var OR `wrangler login`
#
# After the first run, every subsequent run is just step 4.

set -euo pipefail

cd "$(dirname "$0")/.."

# Pretty output
green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
blue()  { printf "\033[1;34m%s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m%s\033[0m\n" "$*"; }
die()   { printf "\033[1;31m%s\033[0m\n" "$*" >&2; exit 1; }

# Pre-flight
command -v wrangler >/dev/null 2>&1 || die "wrangler not found. npm install -g wrangler@4"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  warn "CLOUDFLARE_API_TOKEN not set — falling back to wrangler login"
fi

# 1. Create D1 (idempotent — wrangler prints 'already exists' if it does)
blue "▸ Creating D1 database 'cadence-db' (idempotent)..."
if wrangler d1 create cadence-db 2>&1 | tee /tmp/d1-create.log; then
  green "✓ D1 created or already exists"
else
  grep -q "already exists" /tmp/d1-create.log && green "✓ D1 already exists" || die "D1 create failed"
fi

# Extract the database_id from the create output and patch wrangler.toml if needed
DB_ID=$(grep -oE 'database_id = "[a-f0-9-]+"' wrangler.toml | head -1 | grep -oE '[a-f0-9-]{36}' || true)
if [[ -z "$DB_ID" || "$DB_ID" == "REPLACE_WITH_REAL_DB_ID" ]]; then
  warn "Database id not yet patched in wrangler.toml"
  warn "Run: wrangler d1 create cadence-db"
  warn "Then paste the database_id into wrangler.toml under [[d1_databases]]"
  warn "Then re-run this script."
  exit 1
fi

# 2. Apply migrations + seed
blue "▸ Applying migrations..."
wrangler d1 migrations apply cadence-db --remote
blue "▸ Seeding data..."
wrangler d1 execute cadence-db --remote --file=./seed.sql

# 3. Secrets
blue "▸ Setting secrets (you'll be prompted for values not already set)..."
for s in AUTH_TOKEN TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  if [[ -n "${!s:-}" ]]; then
    echo "$s" | wrangler secret put "$s" -- >/dev/null 2>&1 || true
    echo "  ✓ $s (from env)"
  else
    if wrangler secret list 2>/dev/null | grep -qE "^\"?${s}\"?"; then
      echo "  ✓ $s (already set)"
    else
      echo "  ? $s — please enter a value"
      wrangler secret put "$s"
    fi
  fi
done

# 4. Deploy
blue "▸ Deploying Worker..."
wrangler deploy

# 5. URL
WORKER_URL=$(wrangler deployments list 2>/dev/null | head -1 || echo "")
green "✓ Deployed."
blue "Default URL: https://cadence.<your-cf-subdomain>.workers.dev"
blue "Bind your custom domain (e.g. cadence.example.com) via Cloudflare dashboard → Workers → cadence → Settings → Triggers → Custom Domains"
echo
echo "Smoke test:"
echo "  curl https://cadence.<your-domain>/api/health"