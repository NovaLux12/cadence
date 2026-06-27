-- Cadence — Jack's seed data
-- All items drawn from /home/jack/.openclaw/workspace/USER.md (2026-05-06 update + 2026-06 changes)
-- Times in BST/GMT; alert windows default to 30,14,7,1 days.

-- =========================================================
-- Subscriptions (recurring paid services)
-- =========================================================
INSERT INTO subscriptions (name, vendor, category, cost_pence, currency, billing_cycle, next_due_date, auto_renew, status, alert_windows, notes) VALUES
('Fastmail', 'Fastmail', 'email', 500, 'GBP', 'monthly', '2026-07-12', 1, 'active', '30,14,7,1', 'Primary email. ~55 masked aliases.'),
('1Password Families', '1Password', 'security', 599, 'GBP', 'yearly', '2027-02-14', 1, 'active', '30,14,7,1', 'Jack + Lou. Service account P6GQFO3TXRAR5B7SQZPVTMK6HE.'),
('iCloud+ 2TB', 'Apple', 'storage', 899, 'GBP', 'monthly', '2026-07-04', 1, 'active', '30,14,7,1', 'MacBook backup + iOS sync.'),
('Tailscale', 'Tailscale', 'networking', 0, 'GBP', 'monthly', NULL, 1, 'active', '30,14,7,1', 'Mesh VPN for lee-lab + remote access. Free tier.'),
('Cloudflare', 'Cloudflare', 'networking', 0, 'GBP', 'monthly', NULL, 1, 'active', '30,14,7,1', 'DNS for jacklee.co.uk + Workers. Free.'),
('Brave Search API', 'Brave', 'developer', 0, 'USD', 'monthly', '2026-07-04', 1, 'active', '30,14,7,1', 'Search plan. $5 free monthly credit (~1000 searches).'),
('Lex Autolease — Kuga PHEV', 'Lex Autolease', 'vehicle', 32900, 'GBP', 'monthly', '2026-07-15', 1, 'active', '30,14,7,1', 'Ford Kuga PHEV lease, ends Nov 2028.'),
('Car insurance — Ford Kuga', 'Hastings Direct', 'vehicle', 0, 'GBP', 'yearly', '2027-01-08', 1, 'active', '30,14,7,1', 'Annual. tought.bus6499@ alias.'),
('Home contents insurance', '?', 'home', NULL, 'GBP', 'yearly', NULL, 1, 'active', '30,14,7,1', 'TODO: confirm provider + renewal date.'),
('OpenRouter', 'OpenRouter', 'developer', 0, 'USD', 'monthly', NULL, 1, 'active', '30,14,7,1', 'Free model routing for OpenClaw.'),
('CB1 Pharmacy subscription', 'CB1 Pharmacy', 'health', NULL, 'GBP', 'monthly', NULL, 1, 'active', '30,14,7,1', 'Medical cannabis. Recurring orders — exact schedule TBD.'),
('Outfox — energy tariff', 'Outfox the Market', 'utilities', NULL, 'GBP', 'yearly', NULL, 1, 'active', '30,14,7,1', 'Fix''d tariff. 19.98p/kWh electric, 6.26p/kWh gas. Renewal date TBD.'),
('Easee (charger)', 'EV Connect SE', 'vehicle', 0, 'GBP', 'monthly', NULL, 1, 'active', '30,14,7,1', 'Home EV charger. £0.1998/kWh. May be billed via Outfox.'),
('Anthropic API key', 'Anthropic', 'developer', 0, 'USD', 'monthly', '2026-08-15', 1, 'active', '30,14,7,1', 'Claude via OpenClaw. PAT rotation.'),
('GitHub PAT (Nova)', 'GitHub', 'developer', 0, 'USD', 'yearly', '2026-09-04', 1, 'active', '30,14,7,1', 'Classic PAT, 22 scopes. 90-day default expiry.');

-- =========================================================
-- Reminders (cadence health/vehicle/admin)
-- next_due computed from last_done + cadence_value/unit
-- =========================================================
INSERT INTO reminders (title, category, cadence_value, cadence_unit, last_done, next_due, alert_windows, notes) VALUES
('NHS prescription prepayment', 'health', 12, 'months', '2026-01-10', '2027-01-10', '30,14,7,1', 'PPC covers all NHS prescriptions. Renew online at nhsbsa.nhs.uk.'),
('MOT — Ford Kuga', 'vehicle', 12, 'months', '2025-09-22', '2026-09-22', '30,14,7,1', 'Annual. DVSA reminder sent 1 month before.'),
('Dental check-up', 'health', 6, 'months', '2026-03-15', '2026-09-15', '30,14,7,1', 'NHS dentist. Maidstone.'),
('Contact lenses reorder', 'health', 3, 'months', '2026-05-12', '2026-08-12', '30,14,7,1', 'Quarterly. Reorder before running out.'),
('Kuga service interval', 'vehicle', 12, 'months', '2025-11-08', '2026-11-08', '30,14,7,1', 'Yearly Ford service. Check odo vs schedule.'),
('MacBook battery health check', 'personal', 12, 'months', '2025-09-01', '2026-09-01', '30,14,7,1', 'Cycle count + condition report.'),
('Time Machine verification', 'personal', 1, 'weeks', '2026-06-25', '2026-07-02', '7,1', 'Confirm latest backup is completing on Tailscale share.'),
('GL.iNet router firmware check', 'home', 3, 'months', '2026-04-15', '2026-07-15', '30,14,7,1', 'OpenWrt updates. Reboot-after-update triggers SMB TM share path revert.'),
('Fragrance Hub UK Lattafa restock check', 'personal', 7, 'days', '2026-06-27', '2026-07-04', '7,1', 'Manual check — sells out fast. Items on watchlist.'),
('NHS hybrid closed loop pump review', 'health', 3, 'months', '2026-05-04', '2026-08-04', '30,14,7,1', 'Kent/Maidstone area. Tracking progress on HCL system.'),
('CB1 Pharmacy order', 'health', 4, 'weeks', '2026-06-22', '2026-07-20', '14,7,1', 'Recurring medical cannabis delivery.');

-- =========================================================
-- Watchlist (active cases / contracts / decisions)
-- =========================================================
INSERT INTO watchlist (title, category, status, next_action_date, next_action_label, parties, alert_windows, notes) VALUES
('Aviva / DWF subrogation case', 'case', 'waiting', '2026-07-18', 'DWF reply deadline', 'Aviva / DWF Law', '30,14,7,1', 'Road traffic incident Jan 2026. Awaiting DWF response. Monitor inbox for correspondence.'),
('Lex Autolease lease end', 'contract', 'open', '2028-11-30', 'Lease expiry / return prep', 'Lex Autolease', '90,60,30,14,7,1', 'Ford Kuga PHEV lease. Plan return or renewal ~3 months out.'),
('GL.iNet SMB Time Machine path bug', 'case', 'open', NULL, NULL, 'GL.iNet / Samba', '30,14,7,1', 'Reboots revert TM share path. Manual sed + samba4 restart. Tracking workaround.'),
('NHS HCL insulin pump journey', 'decision', 'open', NULL, NULL, 'NHS Kent & Maidstone', '30,14,7,1', 'Hybrid closed loop system. Active enrollment phase.'),
('Lou driving licence renewal (assumption)', 'admin', 'open', NULL, NULL, 'DVLA', '30,14,7,1', 'TODO: confirm date. Lou holds licence but doesn''t drive.');

-- =========================================================
-- Vehicle settings
-- =========================================================
INSERT INTO vehicle_settings (vehicle, display_name, reg_plate, fuel_type, current_odo_miles, battery_capacity_kwh, home_electricity_pence_per_kwh, notes) VALUES
('kuga', 'Ford Kuga PHEV', NULL, 'phev', NULL, 14.4, 19.98, 'Lex Autolease until Nov 2028. Home charge via Easee @ £0.1998/kWh (close to Outfox 19.98p/kWh tariff).');

-- =========================================================
-- A few sample vehicle entries (placeholder; real ones via the UI)
-- =========================================================
INSERT INTO vehicle_entries (vehicle, entry_type, entry_date, odometer_miles, kwh, litres, cost_pence, unit, location, is_home_charge, notes) VALUES
('kuga', 'charge', '2026-06-26', NULL, 9.8, NULL, 1958, 'p/kWh', 'Easee (home)', 1, 'Approx. 19.98p/kWh Outfox tariff.'),
('kuga', 'fuel',   '2026-06-18', NULL, NULL, 38.4, 6298, 'p/litre', 'Shell Maidstone', 0, 'Petrol top-up.'),
('kuga', 'charge', '2026-06-12', NULL, 12.1, NULL, 2418, 'p/kWh', 'Easee (home)', 1, 'Overnight charge.');