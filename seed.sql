-- Cadence — placeholder seed data
-- Demonstrates the schema with neutral example items.
-- Replace these via the UI once you've deployed.

-- =========================================================
-- Subscriptions
-- =========================================================
INSERT INTO subscriptions (name, vendor, category, cost_pence, currency, billing_cycle, next_due_date, auto_renew, status, alert_windows, notes) VALUES
('Cloud storage', 'Example Cloud', 'storage', 999, 'GBP', 'monthly', '2027-01-04', 1, 'active', '30,14,7,1', 'Placeholder subscription. Replace via UI.'),
('Email service', 'Example Mail', 'email', 500, 'GBP', 'monthly', '2027-01-12', 1, 'active', '30,14,7,1', 'Placeholder subscription. Replace via UI.'),
('Password manager', 'Example Vault', 'security', 599, 'GBP', 'yearly',  '2027-02-14', 1, 'active', '30,14,7,1', 'Placeholder subscription. Replace via UI.'),
('Domain registration', 'Example Registrar', 'networking', 1200, 'GBP', 'yearly', '2027-03-22', 1, 'active', '30,14,7,1', 'Placeholder subscription. Replace via UI.'),
('Search API', 'Example Search', 'developer', 0, 'USD', 'monthly', '2027-01-04', 1, 'active', '30,14,7,1', 'Placeholder subscription with free tier.'),
('Vehicle lease', 'Example Lease Co', 'vehicle', 32900, 'GBP', 'monthly', '2027-01-15', 1, 'active', '30,14,7,1', 'Placeholder. Replace with your real lease.'),
('Vehicle insurance', 'Example Insurance', 'vehicle', 0, 'GBP', 'yearly', '2027-01-08', 1, 'active', '30,14,7,1', 'Placeholder. Replace with your real insurer.'),
('Home insurance', 'Example Insurance', 'home', NULL, 'GBP', 'yearly', NULL, 1, 'active', '30,14,7,1', 'Placeholder. Add your real renewal date.'),
('Energy tariff', 'Example Energy', 'utilities', NULL, 'GBP', 'yearly', NULL, 1, 'active', '30,14,7,1', 'Placeholder. Add your real tariff rates.'),
('EV charger subscription', 'Example Charger', 'vehicle', 0, 'GBP', 'monthly', NULL, 1, 'active', '30,14,7,1', 'Placeholder. Add your home charger.');

-- =========================================================
-- Reminders
-- =========================================================
INSERT INTO reminders (title, category, cadence_value, cadence_unit, last_done, next_due, alert_windows, notes) VALUES
('Annual prescription prepayment', 'health', 12, 'months', '2027-01-10', '2028-01-10', '30,14,7,1', 'Annual certificate. Replace with your real renewal.'),
('Annual vehicle inspection', 'vehicle', 12, 'months', '2026-09-22', '2027-09-22', '30,14,7,1', 'Annual check-up. Replace with your real schedule.'),
('Dental check-up', 'health', 6, 'months', '2026-09-15', '2027-03-15', '30,14,7,1', 'Six-monthly. Replace with your real cadence.'),
('Contact lenses reorder', 'health', 3, 'months', '2026-11-12', '2027-02-12', '30,14,7,1', 'Quarterly. Replace with your real cadence.'),
('Vehicle service interval', 'vehicle', 12, 'months', '2026-11-08', '2027-11-08', '30,14,7,1', 'Yearly service. Replace with your real interval.'),
('Laptop battery health check', 'personal', 12, 'months', '2026-09-01', '2027-09-01', '30,14,7,1', 'Yearly check. Replace with your real device.'),
('Backup verification', 'personal', 1, 'weeks', '2027-01-04', '2027-01-11', '7,1', 'Weekly backup smoke test.'),
('Router firmware check', 'home', 3, 'months', '2026-10-15', '2027-01-15', '30,14,7,1', 'Quarterly firmware review.'),
('Wishlist restock check', 'personal', 7, 'days', '2027-01-09', '2027-01-16', '7,1', 'Weekly check for in-stock items.'),
('Medical review', 'health', 3, 'months', '2026-11-04', '2027-02-04', '30,14,7,1', 'Quarterly review. Replace with your real cadence.'),
('Prescription order', 'health', 4, 'weeks', '2027-01-05', '2027-02-02', '14,7,1', 'Recurring prescription.');

-- =========================================================
-- Watchlist
-- =========================================================
INSERT INTO watchlist (title, category, status, next_action_date, next_action_label, parties, alert_windows, notes) VALUES
('Insurance claim follow-up', 'case', 'waiting', '2027-01-18', 'Counterparty reply deadline', 'Placeholder / Placeholder Law', '30,14,7,1', 'Placeholder case. Replace with your real one.'),
('Lease end', 'contract', 'open', '2029-11-30', 'Lease expiry / return prep', 'Placeholder Lease Co', '90,60,30,14,7,1', 'Placeholder contract. Replace with your real one.'),
('Router SMB share bug', 'case', 'open', NULL, NULL, 'Placeholder Vendor', '30,14,7,1', 'Placeholder. Replace with your real issue.'),
('Healthcare enrollment', 'decision', 'open', NULL, NULL, 'Placeholder Provider', '30,14,7,1', 'Placeholder decision. Replace with your real one.'),
('Driving licence renewal', 'admin', 'open', NULL, NULL, 'DVLA', '30,14,7,1', 'Placeholder. Replace with the real renewal date.');

-- =========================================================
-- Vehicle settings
-- =========================================================
INSERT INTO vehicle_settings (vehicle, display_name, reg_plate, fuel_type, current_odo_miles, battery_capacity_kwh, home_electricity_pence_per_kwh, notes) VALUES
('mycar', 'Family Car', NULL, 'phev', NULL, 15.0, 20.00, 'Placeholder. Replace with your real vehicle.');

-- =========================================================
-- A few sample vehicle entries (placeholder; real ones via the UI)
-- =========================================================
INSERT INTO vehicle_entries (vehicle, entry_type, entry_date, odometer_miles, kwh, litres, cost_pence, unit, location, is_home_charge, notes) VALUES
('mycar', 'charge', '2027-01-08', NULL, 9.8, NULL, 1958, 'p/kWh', 'Home charger', 1, 'Placeholder charge session.'),
('mycar', 'fuel',   '2026-12-18', NULL, NULL, 38.4, 6298, 'p/litre', 'Local forecourt', 0, 'Placeholder fuel fill.'),
('mycar', 'charge', '2026-12-12', NULL, 12.1, NULL, 2418, 'p/kWh', 'Home charger', 1, 'Placeholder charge session.');