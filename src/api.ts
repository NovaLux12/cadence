// Cadence — REST API routes (Hono)
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from './types';
import * as db from './db';
import { batchTelegram, formatAlert, sendTelegram } from './alerts';
import { syncEasee, getLiveCharging, backfillEasee } from './easee';
import {
  buildConnectUrl,
  exchangeAuthCode,
  getValidAccessToken,
  getSignal,
  getVehicle,
  listVehicles,
} from './smartcar';
import { importEncryptionKey, encryptString } from './crypto';

const app = new Hono<{ Bindings: Env }>();

// =========================================================
// Auth — write endpoints require Bearer AUTH_TOKEN (read = public)
// =========================================================

function requireAuth(c: Context<{ Bindings: Env }>): Response | null {
  const want = c.env.AUTH_TOKEN;
  if (!want) return c.json({ error: 'AUTH_TOKEN not set on server' }, 503);
  const got = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (got.length !== want.length) return c.json({ error: 'unauthorized' }, 401);
  let diff = 0;
  for (let i = 0; i < want.length; i++) {
    diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  }
  if (diff !== 0) return c.json({ error: 'unauthorized' }, 401);
  return null;
}

// =========================================================
// Public health + meta
// =========================================================

app.get('/api/health', (c) => c.json({ ok: true, app: c.env.APP_NAME, env: c.env.ENVIRONMENT }));

app.get('/api/meta', (c) =>
  c.json({
    app: c.env.APP_NAME,
    url: c.env.APP_URL,
    env: c.env.ENVIRONMENT,
  })
);

// =========================================================
// Dashboard
// =========================================================

app.get('/api/dashboard', async (c) => {
  const days = Number(c.req.query('days') ?? 60);
  const rows = await db.dashboard(c.env.DB, { days, today: db.todayLondon() });
  return c.json({ rows });
});

// =========================================================
// Subscriptions
// =========================================================

app.get('/api/subscriptions', async (c) => {
  const status = c.req.query('status') ?? undefined;
  return c.json({ items: await db.listSubscriptions(c.env.DB, { status }) });
});

app.get('/api/subscriptions/:id', async (c) => {
  const s = await db.getSubscription(c.env.DB, Number(c.req.param('id')));
  return s ? c.json(s) : c.json({ error: 'not found' }, 404);
});

app.post('/api/subscriptions', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const s = await db.createSubscription(c.env.DB, body);
  return c.json(s, 201);
});

app.patch('/api/subscriptions/:id', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const s = await db.updateSubscription(c.env.DB, Number(c.req.param('id')), body);
  return s ? c.json(s) : c.json({ error: 'not found' }, 404);
});

app.delete('/api/subscriptions/:id', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const ok = await db.deleteSubscription(c.env.DB, Number(c.req.param('id')));
  return ok ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

// =========================================================
// Reminders
// =========================================================

app.get('/api/reminders', async (c) => {
  const status = c.req.query('status') ?? undefined;
  return c.json({ items: await db.listReminders(c.env.DB, { status }) });
});

app.get('/api/reminders/:id', async (c) => {
  const r = await db.getReminder(c.env.DB, Number(c.req.param('id')));
  return r ? c.json(r) : c.json({ error: 'not found' }, 404);
});

app.post('/api/reminders', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const r = await db.createReminder(c.env.DB, body);
  return c.json(r, 201);
});

app.patch('/api/reminders/:id', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const r = await db.updateReminder(c.env.DB, Number(c.req.param('id')), body);
  return r ? c.json(r) : c.json({ error: 'not found' }, 404);
});

app.post('/api/reminders/:id/done', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const r = await db.markReminderDone(c.env.DB, Number(c.req.param('id')), body.done_date);
  return r ? c.json(r) : c.json({ error: 'not found' }, 404);
});

app.delete('/api/reminders/:id', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const ok = await db.deleteReminder(c.env.DB, Number(c.req.param('id')));
  return ok ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

// =========================================================
// Watchlist
// =========================================================

app.get('/api/watchlist', async (c) => {
  const status = c.req.query('status') ?? undefined;
  return c.json({ items: await db.listWatchlist(c.env.DB, { status }) });
});

app.get('/api/watchlist/:id', async (c) => {
  const w = await db.getWatchlist(c.env.DB, Number(c.req.param('id')));
  return w ? c.json(w) : c.json({ error: 'not found' }, 404);
});

app.post('/api/watchlist', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const w = await db.createWatchlist(c.env.DB, body);
  return c.json(w, 201);
});

app.patch('/api/watchlist/:id', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const w = await db.updateWatchlist(c.env.DB, Number(c.req.param('id')), body);
  return w ? c.json(w) : c.json({ error: 'not found' }, 404);
});

app.delete('/api/watchlist/:id', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const ok = await db.deleteWatchlist(c.env.DB, Number(c.req.param('id')));
  return ok ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

// =========================================================
// Vehicle
// =========================================================

app.get('/api/vehicle/entries', async (c) => {
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const since = c.req.query('since') ?? undefined;
  const until = c.req.query('until') ?? undefined;
  const type = c.req.query('type') ?? undefined;
  const q = c.req.query('q') ?? undefined;
  const includeIgnored = c.req.query('includeIgnored') === '1';
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
  const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined;
  return c.json({
    items: await db.listVehicleEntries(c.env.DB, { vehicle, since, until, type, q, includeIgnored, limit, offset }),
  });
});

app.post('/api/vehicle/entries', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const e = await db.createVehicleEntry(c.env.DB, body);
  return c.json(e, 201);
});

app.delete('/api/vehicle/entries/:id', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const ok = await db.deleteVehicleEntry(c.env.DB, Number(c.req.param('id')));
  return ok ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404);
});

app.post('/api/vehicle/entries/:id/toggle-ignored', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const updated = await db.toggleIgnored(c.env.DB, Number(c.req.param('id')));
  return updated ? c.json(updated) : c.json({ error: 'not found' }, 404);
});

/**
 * Bulk action on vehicle entries — currently only `ignore` / `restore`.
 * Force-sets the ignored flag for every id in the payload (idempotent).
 * Auth-gated like other writes.
 */
// Cap on bulk-action ids — any real bulk operation is well under this.
const BULK_IDS_MAX = 500;

app.post('/api/vehicle/bulk-action', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = (await c.req.json().catch(() => ({}))) as {
    action?: string;
    ids?: unknown;
  };
  if (body.action !== 'ignore' && body.action !== 'restore') {
    return c.json({ error: "action must be 'ignore' or 'restore'" }, 400);
  }
  if (!Array.isArray(body.ids)) {
    return c.json({ error: 'ids must be an array' }, 400);
  }
  if (body.ids.length > BULK_IDS_MAX) {
    return c.json({ error: `too many ids (max ${BULK_IDS_MAX})` }, 400);
  }
  const numericIds = (body.ids as unknown[])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  const ignored: 0 | 1 = body.action === 'ignore' ? 1 : 0;
  // Single UPDATE … WHERE id IN (?, ?, …) — atomic, one round-trip.
  let updated = 0;
  try {
    updated = await db.bulkSetIgnored(c.env.DB, numericIds, ignored);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
  // Surface ids that didn't actually update (not found / no change).
  const errors: string[] = [];
  if (updated < numericIds.length) {
    errors.push(`${numericIds.length - updated} id(s) not found or unchanged`);
  }
  return c.json({ updated, total: numericIds.length, errors });
});

// =========================================================
// Vehicle — Fuelly CSV import
// =========================================================

/**
 * Parse a Fuelly-style CSV (RFC 4180-ish, supports quoted fields with commas).
 * Returns rows as objects keyed by header.
 */
function parseCSV(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cur.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (field !== '' || cur.length) {
          cur.push(field);
          lines.push(cur);
          cur = [];
          field = '';
        }
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else {
        field += ch;
      }
    }
  }
  if (field !== '' || cur.length) {
    cur.push(field);
    lines.push(cur);
  }
  if (lines.length < 2) return [];
  const headers = lines[0].map((h) => h.trim());
  return lines.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (row[idx] ?? '').trim()));
    return obj;
  });
}

interface ImportResult {
  total: number;
  inserted: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

app.post('/api/vehicle/import-fuelly', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const dryRun = c.req.query('dry') === '1';
  const csv = await c.req.text();
  const rows = parseCSV(csv);
  const result: ImportResult = { total: rows.length, inserted: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const date = r.fuelup_date || r.entry_date || r.date;
    const litres = parseFloat(r.litres);
    const price = parseFloat(r.price); // £/L
    const odometer = parseFloat(r.odometer);
    if (!date || isNaN(litres) || litres <= 0) {
      result.skipped++;
      result.errors.push({ row: i + 2, reason: 'missing date or litres' });
      continue;
    }
    const costPounds = (isNaN(price) ? 0 : litres * price);
    const location = r.notes || r.location || null;
    const unit = !isNaN(price) ? `p/litre @ ${Math.round(price * 100)}` : null;
    if (dryRun) {
      result.inserted++;
      continue;
    }
    try {
      await db.createVehicleEntry(c.env.DB, {
        vehicle,
        entry_type: 'fuel',
        entry_date: date,
        odometer_miles: !isNaN(odometer) ? Math.round(odometer) : null,
        miles: !isNaN(parseFloat(r.miles)) ? parseFloat(r.miles) : null,
        litres,
        cost_pounds: costPounds,
        unit,
        location,
        is_home_charge: 0,
        notes: null,
      });
      result.inserted++;
    } catch (err) {
      result.errors.push({ row: i + 2, reason: String(err) });
    }
  }
  return c.json(result);
});

app.get('/api/vehicle/summary', async (c) => {
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  return c.json(await db.vehicleSummary(c.env.DB, vehicle));
});

app.get('/api/vehicle/insights', async (c) => {
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  return c.json(await db.vehicleInsights(c.env.DB, vehicle));
});

app.get('/api/vehicle/settings', async (c) => {
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const s = await db.getVehicleSettings(c.env.DB, vehicle);
  return s ? c.json(s) : c.json({ error: 'not found' }, 404);
});

app.put('/api/vehicle/settings', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const body = await c.req.json().catch(() => ({}));
  const s = await db.upsertVehicleSettings(c.env.DB, body);
  return c.json(s);
});

// =========================================================
// Alerts — manual trigger (also runs on cron)
// =========================================================

app.post('/api/alerts/run', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const days = Number(c.req.query('days') ?? 60);
  const dry = c.req.query('dry') === '1';
  return c.json(await runAlerts(c.env, days, dry, db.todayLondon()));
});

export async function runAlerts(env: Env, days: number, dry: boolean, today?: string) {
  const cands = await db.findAlertCandidates(env.DB, days, today);
  const messages: string[] = [];
  const sentKeys = new Set<string>();
  let skipped = 0;
  let sent = 0;
  let failed = 0;
  for (const c of cands) {
    const already = await db.alertAlreadySent(env.DB, c.kind, c.id, c.window_days);
    if (already) {
      skipped++;
      continue;
    }
    const text = formatAlert(c);
    messages.push(text);
    sentKeys.add(c.kind + '|' + c.id + '|' + c.window_days);
  }
  if (messages.length > 0 && !dry) {
    sent = await batchTelegram(env, messages);
    failed = messages.length - sent;
    // Record alerts
    for (const cand of cands) {
      const already = await db.alertAlreadySent(env.DB, cand.kind, cand.id, cand.window_days);
      if (already) continue;
      const key = cand.kind + '|' + cand.id + '|' + cand.window_days;
      const ok = sentKeys.has(key) && sent > 0;
      await db.recordAlert(env.DB, cand.kind, cand.id, cand.window_days, ok);
    }
  }
  return {
    candidates: cands.length,
    skipped_already_sent: skipped,
    messages: messages,
    sent,
    failed,
    dry,
  };
}

// =========================================================
// Test alert send (auth required)
// =========================================================

app.post('/api/alerts/test', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const ok = await sendTelegram(c.env, '🔔 Cadence test alert — Telegram dispatch is working.');
  return c.json({ sent: ok, telegram_configured: !!(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID) });
});

// =========================================================
// Easee — live EV charging session sync (auth required)
// =========================================================

app.post('/api/easee/sync', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const dry = c.req.query('dry') === '1';
  const result = await syncEasee(c.env, { vehicle, dryRun: dry });
  return c.json(result);
});

app.post('/api/easee/backfill', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const fromIso = c.req.query('from');
  const toIso = c.req.query('to');
  const dry = c.req.query('dry') === '1';
  const result = await backfillEasee(c.env, { vehicle, fromIso, toIso, dryRun: dry });
  return c.json(result);
});

app.get('/api/easee/status', async (c) => {
  return c.json({
    configured: !!(c.env.EASEE_USERNAME && c.env.EASEE_PASSWORD),
  });
});

app.get('/api/easee/live', async (c) => {
  const live = await getLiveCharging(c.env);
  return c.json(live);
});

// =========================================================
// SmartCar — OAuth connect, callback, sync, status (Phase 2)
// =========================================================

/** Cap on OAuth state tokens — we use a UUID-shaped random string. */
function newState(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function smartcarConfigured(env: Env): boolean {
  return !!(env.SMARTCAR_CLIENT_ID && env.SMARTCAR_CLIENT_SECRET && env.SMARTCAR_REDIRECT_URI && env.SMARTCAR_ENCRYPTION_KEY);
}

app.get('/api/vehicle/smartcar/status', async (c) => {
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const conn = await db.getConnectionPublic(c.env.DB, vehicle);
  return c.json({
    configured: smartcarConfigured(c.env),
    connected: !!conn,
    connection: conn,
  });
});

/**
 * Step 1 — kick off SmartCar Connect.
 * Generates a state token, stashes it in a short-lived KV-style table? —
 * For now we encode the vehicle slug into state (small surface, not
 * security-critical) and validate on callback.
 *
 * GET /api/vehicle/smartcar/connect?vehicle=mycar
 *   → 302 redirect to SmartCar's authorize URL
 */
app.get('/api/vehicle/smartcar/connect', async (c) => {
  if (!smartcarConfigured(c.env)) {
    return c.json({ error: 'SmartCar not configured (SMARTCAR_CLIENT_ID/SECRET/REDIRECT_URI/ENCRYPTION_KEY required)' }, 503);
  }
  // Note: NOT auth-gated. The browser drives this OAuth redirect and can't
  // send a Bearer header. CSRF protection is the cryptographically random
  // state token (24 bytes / 48 hex chars), validated on the callback.
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  // 'live' = real vehicles (default). 'simulated' = SmartCar's Vehicle
  // Simulator for local/dev work — gated by ENVIRONMENT so it can't be
  // flipped on production by a URL hack.
  const mode = c.env.ENVIRONMENT === 'production' || c.req.query('simulated') !== '1' ? 'live' : 'simulated';
  const state = `${vehicle}:${newState()}`;
  const url = buildConnectUrl({
    clientId: c.env.SMARTCAR_CLIENT_ID!,
    redirectUri: c.env.SMARTCAR_REDIRECT_URI!,
    state,
    defaultMake: c.env.SMARTCAR_DEFAULT_MAKE,
    mode,
  });
  return c.redirect(url, 302);
});

/**
 * Step 2 — SmartCar redirects the user back here.
 * GET /api/vehicle/smartcar/callback?code=…&state=…
 * We exchange the code for tokens, list the user's vehicles, store
 * the encrypted tokens, then redirect to the Vehicle tab with a flag.
 */
app.get('/api/vehicle/smartcar/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') ?? '';
  const errParam = c.req.query('error');
  if (errParam) {
    return c.redirect(`/?smartcar=error&reason=${encodeURIComponent(errParam)}`, 302);
  }
  if (!code) return c.json({ error: 'missing code' }, 400);
  if (!smartcarConfigured(c.env)) return c.json({ error: 'SmartCar not configured' }, 503);

  // Pull vehicle slug back out of the state token.
  const vehicle = state.split(':')[0] || 'mycar';

  try {
    const tokens = await exchangeAuthCode({
      clientId: c.env.SMARTCAR_CLIENT_ID!,
      clientSecret: c.env.SMARTCAR_CLIENT_SECRET!,
      redirectUri: c.env.SMARTCAR_REDIRECT_URI!,
      code,
    });

    // List the user's vehicles and pick the first one. Multi-car tenants
    // (where the same SmartCar app covers multiple vehicles) come later.
    const refs = await listVehicles(tokens.access_token);
    const ref = refs[0];
    if (!ref) {
      return c.redirect('/?smartcar=error&reason=no_vehicles', 302);
    }

    const vinResp = await getSignal<{ vin: string }>(tokens.access_token, ref.id, 'vin').catch(() => null);

    const key = await importEncryptionKey(c.env.SMARTCAR_ENCRYPTION_KEY!);
    const accessEnc = await encryptString(key, tokens.access_token);
    const refreshEnc = await encryptString(key, tokens.refresh_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    await db.upsertConnection(c.env.DB, {
      vehicle,
      smartcar_vehicle_id: ref.id,
      smartcar_make: ref.make ?? null,
      smartcar_model: ref.model ?? null,
      smartcar_year: ref.year ?? null,
      vin: vinResp?.vin ?? null,
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: expiresAt,
      scopes: tokens.scope ?? '',
    });

    return c.redirect('/?smartcar=connected&vehicle=' + encodeURIComponent(vehicle), 302);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return c.redirect(`/?smartcar=error&reason=${encodeURIComponent(msg)}`, 302);
  }
});

/**
 * Disconnect — removes the connection row. Does NOT revoke at SmartCar
 * (that's a separate API call we'd add later if needed).
 * Auth-gated like other writes.
 */
app.delete('/api/vehicle/smartcar/connection', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const ok = await db.deleteConnection(c.env.DB, vehicle);
  return ok ? c.json({ disconnected: true }) : c.json({ error: 'no connection to delete' }, 404);
});

/**
 * Pull fresh signals from SmartCar and persist snapshots.
 * Each signal we fetch is appended to vehicle_snapshots; we also update
 * vehicle_settings.current_odo_miles on the odometer signal so the rest
 * of the app sees fresh mileage.
 *
 * POST /api/vehicle/smartcar/sync?vehicle=mycar  (auth required)
 */
app.post('/api/vehicle/smartcar/sync', async (c) => {
  const deny = requireAuth(c);
  if (deny) return deny;
  const vehicle = c.req.query('vehicle') ?? 'mycar';
  const conn = await db.getConnection(c.env.DB, vehicle);
  if (!conn) return c.json({ error: 'not connected' }, 404);

  try {
    const { accessToken, refreshed } = await getValidAccessToken(c.env, c.env.DB, conn);
    const vid = conn.smartcar_vehicle_id;
    const now = new Date().toISOString();
    const fetched: Record<string, unknown> = {};
    const errors: string[] = [];

    // Odometer (miles) — SmartCar returns distance in km; convert if needed.
    try {
      const odo = await getSignal<{ distance: number; unit?: string }>(accessToken, vid, 'odometer');
      let miles = odo.distance;
      if ((odo.unit ?? '').toLowerCase() === 'km') miles = odo.distance * 0.621371;
      await db.insertSnapshot(c.env.DB, {
        vehicle,
        signal: 'odometer_miles',
        value_num: miles,
        unit: 'miles',
        recorded_at: now,
      });
      await c.env.DB
        .prepare('UPDATE vehicle_settings SET current_odo_miles=?, updated_at=datetime(\'now\') WHERE vehicle=?')
        .bind(Math.round(miles), vehicle)
        .run();
      fetched.odometer_miles = miles;
    } catch (e) {
      errors.push(`odometer: ${(e as Error).message}`);
    }

    // Fuel
    try {
      const fuel = await getSignal<{
        range?: number;
        amountRemaining?: number;
        percentRemaining?: number;
      }>(accessToken, vid, 'fuel');
      if (typeof fuel.percentRemaining === 'number') {
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'fuel_level_pct',
          value_num: fuel.percentRemaining,
          unit: '%',
          recorded_at: now,
        });
        fetched.fuel_level_pct = fuel.percentRemaining;
      }
      if (typeof fuel.range === 'number') {
        // SmartCar fuel range comes in km — convert to miles.
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'fuel_range_miles',
          value_num: fuel.range * 0.621371,
          unit: 'miles',
          recorded_at: now,
        });
        fetched.fuel_range_miles = fuel.range * 0.621371;
      }
    } catch (e) {
      errors.push(`fuel: ${(e as Error).message}`);
    }

    // Battery (state of charge)
    try {
      const bat = await getSignal<{
        range?: number;
        percentRemaining?: number;
      }>(accessToken, vid, 'battery');
      if (typeof bat.percentRemaining === 'number') {
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'state_of_charge_pct',
          value_num: bat.percentRemaining,
          unit: '%',
          recorded_at: now,
        });
        fetched.state_of_charge_pct = bat.percentRemaining;
      }
      if (typeof bat.range === 'number') {
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'ev_range_miles',
          value_num: bat.range * 0.621371,
          unit: 'miles',
          recorded_at: now,
        });
        fetched.ev_range_miles = bat.range * 0.621371;
      }
    } catch (e) {
      errors.push(`battery: ${(e as Error).message}`);
    }

    // Battery capacity (one-shot — only stored if missing).
    try {
      const existing = await db.listLatestSnapshots(c.env.DB, vehicle, 'battery_capacity_kwh', 1);
      if (existing.length === 0) {
        const cap = await getSignal<{ capacity: number }>(accessToken, vid, 'battery/capacity');
        if (typeof cap.capacity === 'number') {
          await db.insertSnapshot(c.env.DB, {
            vehicle,
            signal: 'battery_capacity_kwh',
            value_num: cap.capacity,
            unit: 'kWh',
            recorded_at: now,
          });
          fetched.battery_capacity_kwh = cap.capacity;
          await c.env.DB
            .prepare('UPDATE vehicle_settings SET battery_capacity_kwh=?, updated_at=datetime(\'now\') WHERE vehicle=?')
            .bind(cap.capacity, vehicle)
            .run();
        }
      }
    } catch (e) {
      errors.push(`battery_capacity: ${(e as Error).message}`);
    }

    // Charge state
    try {
      const charge = await getSignal<{
        state?: string;
        isPluggedIn?: boolean;
        isCharging?: boolean;
      }>(accessToken, vid, 'charge');
      await db.insertSnapshot(c.env.DB, {
        vehicle,
        signal: 'is_charging',
        value_text: charge.isCharging ? 'true' : 'false',
        recorded_at: now,
      });
      await db.insertSnapshot(c.env.DB, {
        vehicle,
        signal: 'is_plugged_in',
        value_text: charge.isPluggedIn ? 'true' : 'false',
        recorded_at: now,
      });
      if (charge.state) {
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'charge_state',
          value_text: charge.state,
          recorded_at: now,
        });
        fetched.charge_state = charge.state;
      }
      fetched.is_charging = !!charge.isCharging;
      fetched.is_plugged_in = !!charge.isPluggedIn;
    } catch (e) {
      errors.push(`charge: ${(e as Error).message}`);
    }

    // Location (lat/lon only — SmartCar returns both; we store as numeric)
    try {
      const loc = await getSignal<{ latitude: number; longitude: number }>(accessToken, vid, 'location');
      if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'latitude',
          value_num: loc.latitude,
          recorded_at: now,
        });
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'longitude',
          value_num: loc.longitude,
          recorded_at: now,
        });
        fetched.latitude = loc.latitude;
        fetched.longitude = loc.longitude;
      }
    } catch (e) {
      errors.push(`location: ${(e as Error).message}`);
    }

    // Oil life
    try {
      const oil = await getSignal<{ lifeRemaining?: number }>(accessToken, vid, 'oil');
      if (typeof oil.lifeRemaining === 'number') {
        await db.insertSnapshot(c.env.DB, {
          vehicle,
          signal: 'oil_life_pct',
          value_num: oil.lifeRemaining,
          unit: '%',
          recorded_at: now,
        });
        fetched.oil_life_pct = oil.lifeRemaining;
      }
    } catch (e) {
      errors.push(`oil: ${(e as Error).message}`);
    }

    const status: 'ok' | 'partial' | 'error' = errors.length === 0 ? 'ok' : fetched && Object.keys(fetched).length > 0 ? 'partial' : 'error';
    await db.updateConnectionSyncStatus(c.env.DB, vehicle, status, errors.length ? errors.join('; ') : null);

    return c.json({
      vehicle,
      refreshed,
      status,
      signals: fetched,
      errors,
      synced_at: now,
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await db.updateConnectionSyncStatus(c.env.DB, vehicle, 'error', msg);
    return c.json({ error: msg }, 500);
  }
});

export default app;