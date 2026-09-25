/**
 * The config `lifecycle.ts` spawns, and nothing else spawns.
 *
 * It is not registered in `shape/collect.ts` on purpose, for the reason
 * `matrix/fixture/playwright-fixture.config.ts` gives: its one spec is the
 * *subject* of a measurement rather than a test of anything, and counting it
 * would add an end-to-end declaration to the census for a file that asserts a
 * fact about an environment variable.
 *
 * Everything that varies between runs arrives as an environment variable
 * rather than a flag, because the flag under measurement is
 * `--update-snapshots` and a config that read its own knobs from the command
 * line would be competing for it.
 */

import { defineConfig } from '@playwright/test'

const snapshotDir = process.env['FIXTURE_SNAPSHOT_DIR']

if (snapshotDir === undefined || snapshotDir === '') {
  throw new Error('FIXTURE_SNAPSHOT_DIR must be set; lifecycle.ts sets it')
}

export default defineConfig({
  testDir: '.',
  testMatch: ['cell.spec.ts'],
  snapshotPathTemplate: `${snapshotDir}/{arg}{ext}`,
  retries: Number(process.env['FIXTURE_RETRIES'] ?? '0'),
  reporter: [['json', { outputFile: process.env['FIXTURE_REPORT'] ?? 'report.json' }]],
  outputDir: `${snapshotDir}/results`,
})
