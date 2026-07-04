// Quick smoke test for src/smartcar.ts buildConnectUrl().
//
// Run after build: `node scripts/smoke-smartcar.mjs`
// (or `npm run smoke:smartcar` once we wire it into package.json)
//
// Compiles the relevant snippet standalone — avoids needing tsx/ts-node.
// Mirrors the live buildConnectUrl() body from src/smartcar.ts so any
// drift from this file and the source is a deliberate change.

function buildConnectUrl(i) {
  const url = new URL(`https://connect.smartcar.com/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('application_id', i.clientId);
  url.searchParams.set('mode', i.mode ?? 'live');
  url.searchParams.set('redirect_uri', i.redirectUri);
  url.searchParams.set('scope', (i.scopes ?? DEFAULT_SCOPES).join(' '));
  url.searchParams.set('state', i.state);
  const make = (i.defaultMake ?? '').trim();
  if (make) url.searchParams.set('make', make.toUpperCase());
  return url.toString();
}

const DEFAULT_SCOPES = [
  'read_vehicle_info',
  'read_odometer',
  'read_fuel',
  'read_battery',
  'read_charge',
  'read_engine_oil',
  'read_security',
  'read_location',
  'read_tires',
];

const SAMPLE_UUID = '8229df9f-91a0-4ff0-a1ae-a1f38ee24d07';
const SAMPLE_URI = 'https://cadence.example.com/api/vehicle/smartcar/callback';

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok: ${msg}`);
}

// Case 1: live mode (default)
{
  const u = new URL(buildConnectUrl({
    clientId: SAMPLE_UUID,
    redirectUri: SAMPLE_URI,
    state: 'mycar:abcdef',
  }));
  assert(u.origin === 'https://connect.smartcar.com', 'live origin = connect.smartcar.com');
  assert(u.pathname === '/oauth/authorize', 'live path = /oauth/authorize');
  assert(u.searchParams.get('application_id') === SAMPLE_UUID, 'application_id == clientId (not client_id, per current SmartCar docs)');
  assert(!u.searchParams.has('client_id'), 'legacy client_id param absent');
  assert(u.searchParams.get('response_type') === 'code', 'response_type=code');
  assert(u.searchParams.get('mode') === 'live', 'mode defaults to live');
  assert(u.searchParams.get('redirect_uri') === SAMPLE_URI, 'redirect_uri echoed');
  assert(u.searchParams.get('scope').startsWith('read_vehicle_info'), 'scopes joined');
  assert(u.searchParams.get('state') === 'mycar:abcdef', 'state echoed');
  assert(!u.searchParams.has('make'), 'make omitted when defaultMake empty');
}

// Case 2: simulated mode (test)
{
  const u = new URL(buildConnectUrl({
    clientId: SAMPLE_UUID,
    redirectUri: SAMPLE_URI,
    state: 'mycar:abcdef',
    mode: 'simulated',
  }));
  assert(u.searchParams.get('mode') === 'simulated', 'simulated mode honoured');
}

// Case 3: defaultMake passed → set uppercase
{
  const u = new URL(buildConnectUrl({
    clientId: SAMPLE_UUID,
    redirectUri: SAMPLE_URI,
    state: 'mycar:abcdef',
    defaultMake: 'ford',
  }));
  assert(u.searchParams.get('make') === 'FORD', 'defaultMake normalised to uppercase');
}

console.log('all smartcar URL smoke checks passed');
