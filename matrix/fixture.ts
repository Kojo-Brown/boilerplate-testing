/**
 * What is in `fixture/specs/`, written down so the model can be run against it
 * without loading Playwright.
 *
 * This duplicates the spec files, which would normally be a smell. Here it is
 * the measurement: `fixture.test.ts` re-reads the seven files off disk and
 * checks this description against them, so the duplicate is audited rather
 * than trusted, and `partition.test.ts` can compare a model built from *this*
 * against a partition built from *those*. A description generated from the
 * files would agree with them by construction and could never catch the edit
 * that quietly changed what the measurement measures.
 */

import { fileURLToPath } from 'node:url'

import type { ProjectSpec, SpecFile } from './shard.ts'

/** `fixture/`, absolute, for the CLI runs and the on-disk audit. */
export const FIXTURE_DIR = fileURLToPath(new URL('./fixture/', import.meta.url))

/** The config the CLI runs are pointed at. */
export const FIXTURE_CONFIG = `${FIXTURE_DIR}playwright-fixture.config.ts`

function titles(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_unused, at) => `${prefix}-${at + 1}`)
}

/**
 * The seven files, in the order Playwright collects them — which is the order
 * `fs.readdir` returns under a sort, so: alphabetical by path.
 */
export const FIXTURE_FILES: readonly SpecFile[] = [
  { file: 'hooked.spec.ts', titles: titles('hooked', 5), mode: 'sequential', hasAllHooks: true },
  { file: 'medium.spec.ts', titles: titles('medium', 3), mode: 'sequential', hasAllHooks: false },
  { file: 'parallel.spec.ts', titles: titles('parallel', 4), mode: 'parallel', hasAllHooks: false },
  { file: 'plain.spec.ts', titles: titles('plain', 5), mode: 'sequential', hasAllHooks: false },
  { file: 'serial.spec.ts', titles: titles('serial', 5), mode: 'serial', hasAllHooks: false },
  { file: 'small.spec.ts', titles: titles('small', 1), mode: 'sequential', hasAllHooks: false },
]

/** `setup.spec.ts`, which only the `setup` project matches. */
export const SETUP_FILE: SpecFile = {
  file: 'setup.spec.ts',
  titles: titles('setup', 1),
  mode: 'sequential',
  hasAllHooks: false,
}

/** `FIXTURE_PROJECTS=single` — one project, 23 tests, nothing to confuse the partition. */
export const SINGLE_PROJECT: readonly ProjectSpec[] = [{ name: 'solo', files: FIXTURE_FILES }]

/**
 * `FIXTURE_PROJECTS=matrix` — the shape a real cross-browser config has: an
 * auth `setup` project and two browser projects that depend on it.
 */
export const MATRIX_PROJECTS: readonly ProjectSpec[] = [
  { name: 'setup', files: [SETUP_FILE] },
  { name: 'desktop', files: FIXTURE_FILES, dependencies: ['setup'] },
  { name: 'mobile', files: FIXTURE_FILES, dependencies: ['setup'] },
]
