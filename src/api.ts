// Cadence — REST API routes (Hono)
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from './types';
import * as db from './db';
import { batchTelegram, formatAlert, sendTelegram } from './alerts';

const app = new Hono<{ Bindings: Env }>();

// =========================================================
// Auth — write endpoints require Bearer AUTH_TOKEN (read = public)
// =========================================================

function requireAuth(c: Context<{ Bindings: Env }>): Response | null {
  const want = c.env.AUTH_TOKEN;
  if (!want) return c.json({ error: 'AUTH_TOKEN not set on server' }, 503);
  const got = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (got !== want) return c.json({ error: 'unauthorized' }, 401);
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
    telegram: !!(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_CHAT_ID),
  })
);

// =========================================================
// Dashboard
// =========================================================

app.get('/api/dashboard', async (c) => {
  const days = Number(c.req.query('days') ?? 60);
  const rows = await db.dashboard(c.env.DB, { days });
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
  return c.json({ items: await db.listVehicleEntries(c.env.DB, { vehicle, since, until, type }) });
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
  return c.json(await runAlerts(c.env, days, dry));
});

export async function runAlerts(env: Env, days: number, dry: boolean) {
  const cands = await db.findAlertCandidates(env.DB, days);
  const messages: string[] = [];
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
  }
  if (messages.length > 0 && !dry) {
    sent = await batchTelegram(env, messages);
    failed = messages.length - sent;
    // Record alerts
    for (const cand of cands) {
      const already = await db.alertAlreadySent(env.DB, cand.kind, cand.id, cand.window_days);
      if (already) continue;
      const txt = formatAlert(cand);
      const ok = messages.includes(txt) && sent > 0;
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

export default app;