// Cadence — SmartCar API integration
// Public docs: https://smartcar.com/docs
//
// Auth flow: OAuth 2.0 authorization code with PKCE-style state token.
//   1. GET  /api/vehicle/connect           → redirect user to SmartCar Connect
//   2. SmartCar → redirects back to /api/vehicle/callback?code=…&state=…
//   3. POST /oauth/token (client_credentials_basic) → access + refresh tokens
//   4. Store encrypted tokens + refresh as needed; access tokens expire after 2h.
//
// API base: https://vehicle.api.smartcar.com/v3
//
// Signals we read (vehicle-specific — see Compatibility API for the full
// per-make/model/powertrain matrix at https://compatibility.api.smartcar.com):
//   /odometer                  → {distance, unit}            permission read_odometer
//   /fuel                      → {range, amountRemaining, percentRemaining}
//   /battery                   → {range, percentRemaining, chargeStatus}
//   /battery/capacity          → {capacity}
//   /charge                    → {isPluggedIn, isCharging, state, ...}
//   /location                  → {latitude, longitude}
//   /vin                       → {vin}
//   /tires                     → {frontLeft, frontRight, ...}
//   /oil                       → {lifeRemaining}
//   /security                  → {isLocked, doors: {frontLeft, ...}}

import type { Env } from './types';
import { importEncryptionKey, encryptString, decryptString } from './crypto';

// Hosts: per the docs
//   connect.smartcar.com — user-facing authorize URL (/oauth/authorize)
//   auth.smartcar.com    — token exchange + refresh (/oauth/token)
//   iam.smartcar.com     — app-level client_credentials (NOT used here —
//                          cadence drives the user-scoped code flow)
const SMARTCAR_AUTH = 'https://connect.smartcar.com';
const SMARTCAR_TOKEN = 'https://auth.smartcar.com';
const SMARTCAR_API = 'https://vehicle.api.smartcar.com/v3';

// Full scope set — adjusted per-tenant at request time if needed.
export const DEFAULT_SCOPES = [
  'read_vehicle_info',
  'read_odometer',
  'read_fuel',
  'read_battery',
  'read_charge',
  'read_engine_oil',
  'read_security',
  'read_location',
  'read_tires',
] as const;

export type Scope = (typeof DEFAULT_SCOPES)[number];

// =========================================================
// Connect — build the OAuth start URL
// =========================================================

export interface ConnectInputs {
  // SmartCar's UUID-style App ID from the dashboard. Used BOTH as the
  // `application_id` query param here AND as the OAuth `client_id`
  // username in Basic auth at /oauth/token. SmartCar exposes one
  // identifier; the two names are aliases.
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly Scope[];
  defaultMake?: string;
  mode?: 'live' | 'simulated';      // 'live' = real vehicles (default), 'simulated' = test vehicles
}

export function buildConnectUrl(i: ConnectInputs): string {
  const url = new URL(`${SMARTCAR_AUTH}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  // SmartCar's current authorize-URL parameter name is `application_id`.
  // The Java SDK / older docs use `client_id`; the field is the same UUID.
  url.searchParams.set('application_id', i.clientId);
  url.searchParams.set('mode', i.mode ?? 'live');
  url.searchParams.set('redirect_uri', i.redirectUri);
  url.searchParams.set('scope', (i.scopes ?? DEFAULT_SCOPES).join(' '));
  url.searchParams.set('state', i.state);
  // Skip SmartCar's make-selection screen if a default make is configured.
  // Most SmartCar apps are scoped to a single OEM. Override via
  // SMARTCAR_DEFAULT_MAKE; empty → SmartCar shows the selector.
  const make = (i.defaultMake ?? '').trim();
  if (make) url.searchParams.set('make', make.toUpperCase());
  return url.toString();
}

// =========================================================
// Token exchange + refresh
// =========================================================

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (typically 7200 = 2h)
  token_type: 'Bearer';
  scope?: string;
}

interface ExchangeInputs {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}

export async function exchangeAuthCode(i: ExchangeInputs): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: i.code,
    redirect_uri: i.redirectUri,
  });
  const r = await fetch(`${SMARTCAR_TOKEN}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${i.clientId}:${i.clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`token exchange failed: ${r.status} ${text}`);
  }
  return (await r.json()) as TokenResponse;
}

export async function refreshTokens(i: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: i.refreshToken,
  });
  const r = await fetch(`${SMARTCAR_TOKEN}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${i.clientId}:${i.clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`refresh failed: ${r.status} ${text}`);
  }
  return (await r.json()) as TokenResponse;
}

// =========================================================
// Connection store + token decryption
// =========================================================

export interface VehicleConnection {
  vehicle: string;
  smartcar_vehicle_id: string;
  smartcar_make: string | null;
  smartcar_model: string | null;
  smartcar_year: number | null;
  vin: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
  scopes: string;
  connected_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
  updated_at: string;
}

/** Return a valid access token, refreshing if expiring within 5 min. Throws on failure. */
export async function getValidAccessToken(
  env: Env,
  db: D1Database,
  conn: VehicleConnection,
): Promise<{ accessToken: string; refreshed: boolean }> {
  const key = await importEncryptionKey(env.SMARTCAR_ENCRYPTION_KEY!);
  const refreshToken = await decryptString(key, conn.refresh_token_enc);
  const expiresAt = Date.parse(conn.token_expires_at);
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
  if (Number.isFinite(expiresAt) && expiresAt > fiveMinFromNow) {
    const accessToken = await decryptString(key, conn.access_token_enc);
    return { accessToken, refreshed: false };
  }
  // Refresh
  const tokens = await refreshTokens({
    clientId: env.SMARTCAR_CLIENT_ID!,
    clientSecret: env.SMARTCAR_CLIENT_SECRET!,
    refreshToken,
  });
  const newAccessEnc = await encryptString(key, tokens.access_token);
  const newRefreshEnc = await encryptString(key, tokens.refresh_token);
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await db
    .prepare(
      'UPDATE vehicle_connections SET access_token_enc=?, refresh_token_enc=?, token_expires_at=?, updated_at=datetime(\'now\') WHERE vehicle=?',
    )
    .bind(newAccessEnc, newRefreshEnc, newExpiresAt, conn.vehicle)
    .run();
  return { accessToken: tokens.access_token, refreshed: true };
}

// =========================================================
// Vehicle API helpers (post-OAuth)
// =========================================================

export interface SmartcarVehicleRef {
  id: string;
  make?: string;
  model?: string;
  year?: number;
}

export async function listVehicles(accessToken: string): Promise<SmartcarVehicleRef[]> {
  const r = await fetch(`${SMARTCAR_API}/vehicles`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`list vehicles failed: ${r.status} ${text}`);
  }
  const body = (await r.json()) as { vehicles: string[] };
  // Per docs, /vehicles returns just ids — fetch full info for each.
  const out: SmartcarVehicleRef[] = [];
  for (const id of body.vehicles ?? []) {
    const info = await getVehicle(accessToken, id);
    out.push(info);
  }
  return out;
}

export async function getVehicle(accessToken: string, vehicleId: string): Promise<SmartcarVehicleRef> {
  const r = await fetch(`${SMARTCAR_API}/vehicles/${vehicleId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`get vehicle failed: ${r.status} ${text}`);
  }
  return (await r.json()) as SmartcarVehicleRef;
}

/** Generic typed GET against /vehicles/{id}/{path}. Returns parsed JSON. */
export async function getSignal<T = unknown>(
  accessToken: string,
  vehicleId: string,
  path: string,
): Promise<T> {
  const r = await fetch(`${SMARTCAR_API}/vehicles/${vehicleId}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`get ${path} failed: ${r.status} ${text}`);
  }
  return (await r.json()) as T;
}