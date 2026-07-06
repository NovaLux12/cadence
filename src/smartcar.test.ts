import { describe, expect, test } from 'vitest';

import { buildConnectUrl, DEFAULT_SCOPES } from './smartcar';

const SAMPLE_UUID = '8229df9f-91a0-4ff0-a1ae-a1f38ee24d07';
const SAMPLE_URI = 'https://cadence.example.com/api/vehicle/smartcar/callback';

// ------------------------------------------------------------
// buildConnectUrl
// ------------------------------------------------------------

describe('buildConnectUrl', () => {
  test('uses connect.smartcar.com (NOT legacy auth.smartcar.com)', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
    }));
    expect(u.origin).toBe('https://connect.smartcar.com');
    expect(u.pathname).toBe('/oauth/authorize');
  });

  test('emits application_id (NOT legacy client_id) per current SmartCar docs', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
    }));
    expect(u.searchParams.get('application_id')).toBe(SAMPLE_UUID);
    expect(u.searchParams.has('client_id')).toBe(false);
  });

  test('forces mode=live by default', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
    }));
    expect(u.searchParams.get('mode')).toBe('live');
  });

  test('honours an explicit mode=simulated', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
      mode: 'simulated',
    }));
    expect(u.searchParams.get('mode')).toBe('simulated');
  });

  test('echoes redirect_uri, response_type=code, and state', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
    }));
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe(SAMPLE_URI);
    expect(u.searchParams.get('state')).toBe('mycar:abcdef');
  });

  test('joins DEFAULT_SCOPES into a single space-separated scope param', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
    }));
    const scope = u.searchParams.get('scope');
    expect(scope).not.toBeNull();
    expect(scope!.split(' ').length).toBe(DEFAULT_SCOPES.length);
    for (const s of DEFAULT_SCOPES) {
      expect(scope).toContain(s);
    }
  });

  test('omits the make param when defaultMake is empty', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
      defaultMake: '',
    }));
    expect(u.searchParams.has('make')).toBe(false);
  });

  test('uppercases a non-empty defaultMake to match SmartCar make codes', () => {
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: SAMPLE_URI,
      state: 'mycar:abcdef',
      defaultMake: 'ford',
    }));
    expect(u.searchParams.get('make')).toBe('FORD');
  });

  test('URL-encodes special characters in state and redirect_uri', () => {
    // The vehicle:state separator should round-trip cleanly. Real Slack-style
    // states are random hex anyway, but a regression on encoding would be
    // silent and annoying.
    const u = new URL(buildConnectUrl({
      clientId: SAMPLE_UUID,
      redirectUri: 'https://example.com/cb?foo=bar&baz=qux',
      state: 'mycar:abc def=:?&',
    }));
    expect(u.searchParams.get('redirect_uri')).toBe('https://example.com/cb?foo=bar&baz=qux');
    expect(u.searchParams.get('state')).toBe('mycar:abc def=:?&');
  });
});
