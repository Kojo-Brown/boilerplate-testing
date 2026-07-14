/**
 * Vitest config for the quarantine suite.
 *
 * Run with:
 *   pnpm test:quarantine
 *
 * What this does differently from the main config:
 *   - Sets QUARANTINE=1 so that `quarantine()` calls run instead of skip.
 *   - Applies retry: 3 globally — every quarantined test gets at least 3 attempts.
 *   - Emits a JSON report to quarantine-results/ for trend tracking.
 *   - Does NOT enforce coverage thresholds — quarantine results are informational.
 *
 * Results should be uploaded as a CI artifact and reviewed periodically.
 * When a quarantined test goes green consistently, remove the `quarantine()`
 * wrapper and move it back into the main suite.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest/setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['pact/**', 'node_modules/**'],

    // Activate quarantine mode: quarantine() registers live tests instead of skips.
    env: { QUARANTINE: '1' },

    // Global retry floor — individual quarantine() calls may raise this.
    retry: 3,

    // Verbose output so individual retry attempts are visible in CI logs.
    reporters: ['verbose'],

    outputFile: {
      json: 'quarantine-results/results.json',
    },
  },
  resolve: {
    alias: {
      '@': '.',
    },
  },
})
