// Cadence — shared types
// Cloudflare Worker bindings

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  APP_NAME: string;
  APP_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  AUTH_TOKEN?: string;
}

// Domain types — match migrations/0001_initial.sql

export type BillingCycle = 'monthly' | 'yearly' | 'weekly' | 'one-off';
export type SubStatus = 'active' | 'paused' | 'cancelled';

export interface Subscription {
  id: number;
  name: string;
  vendor: string | null;
  category: string | null;
  cost_pence: number | null;
  currency: string | null;
  billing_cycle: BillingCycle;
  next_due_date: string | null;
  auto_renew: number;
  status: SubStatus;
  alert_windows: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CadenceUnit = 'days' | 'weeks' | 'months' | 'years';
export type RemStatus = 'active' | 'done' | 'snoozed';

export interface Reminder {
  id: number;
  title: string;
  category: string | null;
  cadence_value: number;
  cadence_unit: CadenceUnit;
  last_done: string | null;
  next_due: string | null;
  alert_windows: string;
  notes: string | null;
  status: RemStatus;
  created_at: string;
  updated_at: string;
}

export type WlCategory = 'case' | 'contract' | 'decision' | 'other';
export type WlStatus = 'open' | 'waiting' | 'closed';

export interface WatchlistItem {
  id: number;
  title: string;
  category: string | null;
  status: WlStatus;
  next_action_date: string | null;
  next_action_label: string | null;
  parties: string | null;
  notes: string | null;
  alert_windows: string;
  created_at: string;
  updated_at: string;
}

export type EntryType = 'fuel' | 'charge';

export interface VehicleEntry {
  id: number;
  vehicle: string;
  entry_type: EntryType;
  entry_date: string;
  odometer_miles: number | null;
  kwh: number | null;
  litres: number | null;
  cost_pence: number;
  unit: string | null;
  location: string | null;
  is_home_charge: number;
  notes: string | null;
  created_at: string;
}

export interface VehicleSettings {
  vehicle: string;
  display_name: string;
  reg_plate: string | null;
  fuel_type: string | null;
  current_odo_miles: number | null;
  battery_capacity_kwh: number | null;
  home_electricity_pence_per_kwh: number | null;
  notes: string | null;
  updated_at: string;
}

// Computed / derived types

export interface DashboardRow {
  kind: 'subscription' | 'reminder' | 'watchlist';
  id: number;
  title: string;
  category: string | null;
  status: string;
  due_date: string | null;
  next_action_label: string | null;
  days_until: number | null;
  cost_pence: number | null;
  billing_cycle: string | null;
  notes: string | null;
}

export interface VehicleSummary {
  vehicle: string;
  display_name: string;
  current_odo_miles: number | null;
  last_30d: {
    fuel_pence: number;
    fuel_litres: number;
    charge_pence: number;
    charge_kwh: number;
    home_charge_pence: number;
    home_charge_kwh: number;
    total_miles: number | null;
    total_pence: number;
    pence_per_mile: number | null;
    fuel_mpg: number | null;
  };
  last_90d: {
    fuel_pence: number;
    charge_pence: number;
    total_pence: number;
    pence_per_mile: number | null;
  };
}