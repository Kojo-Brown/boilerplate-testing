/**
 * The subject of the sharding measurement: a Playwright project that exists to
 * be partitioned, not to test anything.
 *
 * `specs/` holds 24 empty tests across seven files, arranged so that every
 * grouping rule in `../grouping.ts` is exercised by at least one of them. The
 * measurement then asks `playwright test --list --shard=k/n` which tests land
 * where, and `../partition.test.ts` checks that against a model of Playwright's
 * algorithm written out in `../shard.ts`.
 *
 * Two knobs, both read from the environment rather than split across three
 * config files, so that the thing under measurement stays one readable page:
 *
 *   - `FIXTURE_FULLY_PARALLEL=1` turns on `fullyParallel`. It is a knob rather
 *     than a constant because it is half of the finding: the same 24 tests
 *     shard into different shapes with it on and off.
 *   - `FIXTURE_PROJECTS=matrix` replaces the single project with a `setup`
 *     project and two browser-shaped projects that depend on it, which is what
 *     makes the dependency-per-shard cost visible.
 *
 * No `use`, no `devices`, no `baseURL`: a device descriptor would launch a
 * browser for tests that have no business needing one, and the partition does
 * not depend on any of it. What the *engine* matrix costs is measured next
 * door, in `../emulation.spec.ts`, against a real browser.
 */

import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

/** The file the `setup` project owns; every other project ignores it. */
export const SETUP_SPEC = '**/setup.spec.ts'

/** `FIXTURE_PROJECTS=matrix` selects the dependency-carrying shape. */
export type FixtureShape = 'single' | 'matrix'

export function shapeFromEnv(value: string | undefined): FixtureShape {
  if (value === undefined || value === 'single') {
    return 'single'
  }

  if (value === 'matrix') {
    return 'matrix'
  }

  throw new Error(`FIXTURE_PROJECTS must be 'single' or 'matrix', got ${JSON.stringify(value)}`)
}

export function projectsFor(shape: FixtureShape): NonNullable<PlaywrightTestConfig['projects']> {
  if (shape === 'single') {
    return [{ name: 'solo', testIgnore: [SETUP_SPEC] }]
  }

  return [
    { name: 'setup', testMatch: [SETUP_SPEC] },
    { name: 'desktop', testIgnore: [SETUP_SPEC], dependencies: ['setup'] },
    { name: 'mobile', testIgnore: [SETUP_SPEC], dependencies: ['setup'] },
  ]
}

export default defineConfig({
  testDir: './specs',
  fullyParallel: process.env['FIXTURE_FULLY_PARALLEL'] === '1',
  // A partition is not a run: nothing here is retried, reported or timed,
  // because every reader of this config is `--list`.
  retries: 0,
  reporter: [['null']],
  // Under `playwright-results/`, which is already ignored, so a `--reporter=blob`
  // run from `../merge.test.ts` cannot leave anything in the working tree.
  outputDir: '../../playwright-results/matrix-fixture',
  projects: projectsFor(shapeFromEnv(process.env['FIXTURE_PROJECTS'])),
})
