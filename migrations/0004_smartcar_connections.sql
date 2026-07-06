-- Cadence migration 0004: SmartCar OAuth connection state per vehicle
-- One row per vehicle (PK = vehicle slug). Tokens are AES-256-GCM encrypted at rest;
-- the key is loaded from env.SMARTCAR_ENCRYPTION_KEY (32-byte secret, base64).

CREATE TABLE IF NOT EXISTS vehicle_connections (
  vehicle TEXT PRIMARY KEY,                  -- 'mycar'
  smartcar_vehicle_id TEXT NOT NULL,         -- SmartCar's vehicle UUID
  smartcar_make TEXT,
  smartcar_model TEXT,
  smartcar_year INTEGER,
  vin TEXT,
  access_token_enc TEXT NOT NULL,            -- AES-GCM ciphertext (base64)
  refresh_token_enc TEXT NOT NULL,           -- AES-GCM ciphertext (base64)
  token_expires_at TEXT NOT NULL,            -- ISO datetime (UTC)
  scopes TEXT NOT NULL,                      -- granted scopes (space-separated)
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_at TEXT,
  last_sync_status TEXT,                     -- ok | error | partial
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_vc_smartcar_vid ON vehicle_connections(smartcar_vehicle_id);