import { defineConfig } from 'vitest/config';

// Cadence — vitest config.
//
// Pure-function tests only (no Workers bindings, no D1). If we ever want
// handler-level tests via wrangler's experimental pool, add
// `pool: '@wrangler/vitest-pool-workers'` here.

export default defineConfig({
  test: {
    globals: false,          // explicit imports — `import { test, expect } from 'vitest'`
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
