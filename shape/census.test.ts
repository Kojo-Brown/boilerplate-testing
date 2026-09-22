// @vitest-environment node
//
// The census reads files off disk, so it needs a filesystem rather than a DOM.

/**
 * The join, tested against counts that are handed in rather than collected.
 *
 * `runCensus` takes its collector as a parameter for exactly this: spawning the
 * real runners inside a test would be slow, would nest Vitest inside Vitest,
 * and would make every assertion here change whenever anybody adds a test
 * anywhere in the repository.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCensus } from './census.ts'
import { EXPECTED_EMPTY, type Census } from './collect.ts'

let tree: string

/** A collector that reports exactly what it is told to. */
const collector =
  (counts: Record<string, number>, doubleCounted: Census['doubleCounted'] = []): (() => Census) =>
  () => ({
    results: [{ runner: 'stub', counts }],
    counts,
    doubleCounted,
  })

beforeAll(() => {
  tree = mkdtempSync(join(tmpdir(), 'shape-census-test-'))

  const put = (relativePath: string, source: string): void => {
    const absolute = join(tree, relativePath)

    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, source, 'utf8')
  }

  put('fast.test.ts', `import { it } from 'vitest'\nit('adds', () => {})\n`)
  put('disk.test.ts', `import { readFileSync } from 'node:fs'\nvoid readFileSync\n`)
  put('browser.spec.ts', `import { test } from '@playwright/test'\nvoid test\n`)
})

afterAll(() => {
  rmSync(tree, { recursive: true, force: true })
})

describe('attaching counts to layers', () => {
  it('totals each layer from the files that belong to it', () => {
    const census = runCensus({
      root: tree,
      collect: collector({ 'fast.test.ts': 70, 'disk.test.ts': 25, 'browser.spec.ts': 5 }),
    })

    expect(census.measurement.counts).toEqual({ unit: 70, integration: 25, e2e: 5 })
    expect(census.measurement.total).toBe(100)
    expect(census.violations).toEqual([])
    expect(census.problems).toEqual([])
  })

  it('carries the boundary evidence through to the report', () => {
    const census = runCensus({
      root: tree,
      collect: collector({ 'fast.test.ts': 70, 'disk.test.ts': 25, 'browser.spec.ts': 5 }),
    })
    const disk = census.files.find((file) => file.file === 'disk.test.ts')

    expect(disk?.evidence.map((entry) => entry.specifier)).toEqual(['node:fs'])
    expect(disk?.evidence[0]?.resource).toBe('filesystem')
  })

  it('fails the policy when the counts say the suite has the wrong shape', () => {
    const census = runCensus({
      root: tree,
      collect: collector({ 'fast.test.ts': 10, 'disk.test.ts': 85, 'browser.spec.ts': 5 }),
    })

    expect(census.violations.length).toBeGreaterThan(0)
    expect(census.violations.some((violation) => violation.kind === 'ordering')).toBe(true)
  })
})

describe('problems the join exists to find', () => {
  it('reports a test file no runner collects anything from', () => {
    const census = runCensus({
      root: tree,
      collect: collector({ 'fast.test.ts': 70, 'disk.test.ts': 25 }),
    })

    expect(census.problems).toContainEqual(
      expect.objectContaining({ kind: 'uncollected-file' }),
    )
    expect(census.problems[0]?.detail).toContain('browser.spec.ts')
  })

  it('reports a file a runner collected that is not a test file on disk', () => {
    const census = runCensus({
      root: tree,
      collect: collector({
        'fast.test.ts': 70,
        'disk.test.ts': 25,
        'browser.spec.ts': 5,
        'ghost/vanished.test.ts': 9,
      }),
    })

    expect(census.problems).toContainEqual(expect.objectContaining({ kind: 'unknown-file' }))
  })

  it('reports a file two runners both claim, rather than counting it twice', () => {
    const counts = { 'fast.test.ts': 70, 'disk.test.ts': 25, 'browser.spec.ts': 5 }
    const census = runCensus({
      root: tree,
      collect: collector(counts, [{ file: 'disk.test.ts', runners: ['vitest', 'vitest (pact)'] }]),
    })

    expect(census.problems).toContainEqual(
      expect.objectContaining({ kind: 'double-counted-file' }),
    )
  })

  it('reports an unclassified module rather than letting it default to unit', () => {
    const isolated = mkdtempSync(join(tmpdir(), 'shape-unclassified-'))

    writeFileSync(
      join(isolated, 'novel.test.ts'),
      `import thing from 'brand-new-package'\nvoid thing\n`,
      'utf8',
    )

    const census = runCensus({
      root: isolated,
      collect: collector({ 'novel.test.ts': 10 }),
    })

    expect(census.problems).toContainEqual(
      expect.objectContaining({ kind: 'unclassified-module' }),
    )

    rmSync(isolated, { recursive: true, force: true })
  })
})

describe('the empty-file exception list', () => {
  it('accepts zero tests only from a file that is listed', () => {
    // `pact/pipeline/matrix.broker.test.ts` is the one file where zero is
    // correct: its suite is `describe.skipIf(!PACT_BROKER_BASE_URL)` and
    // `vitest list` omits skipped tests, so a census run without a broker sees
    // none of its 13. Anything else at zero is a broken include glob.
    //
    // It replaced `pact/provider/users.provider.pact.verify.test.ts`, which
    // was listed here for the same mechanical reason and a much worse
    // underlying one: there was no provider in the repository to point
    // `PROVIDER_BASE_URL` at, so provider verification never ran anywhere.
    //
    // The seven `matrix/fixture/specs/*.spec.ts` entries are the other kind of
    // exception, and the list is pinned exactly so that adding one is a visible
    // edit here rather than a quiet line in `collect.ts`. Those files are the
    // *subject* of the sharding measurement rather than tests: 24 empty
    // declarations that `matrix/partition.test.ts` partitions with
    // `playwright test --list --shard`. Registering their config would add 24
    // end-to-end tests to the pyramid that nobody wrote to catch anything.
    expect(EXPECTED_EMPTY).toEqual([
      'pact/pipeline/matrix.broker.test.ts',
      'matrix/fixture/specs/hooked.spec.ts',
      'matrix/fixture/specs/medium.spec.ts',
      'matrix/fixture/specs/parallel.spec.ts',
      'matrix/fixture/specs/plain.spec.ts',
      'matrix/fixture/specs/serial.spec.ts',
      'matrix/fixture/specs/setup.spec.ts',
      'matrix/fixture/specs/small.spec.ts',
    ])
  })

  it('reports an exception that has outlived its reason', () => {
    const isolated = mkdtempSync(join(tmpdir(), 'shape-stale-'))
    const listed = EXPECTED_EMPTY[0] ?? ''

    mkdirSync(join(isolated, dirname(listed)), { recursive: true })
    writeFileSync(join(isolated, listed), `import { it } from 'vitest'\nit('runs', () => {})\n`, 'utf8')

    const census = runCensus({
      root: isolated,
      collect: collector({ [listed]: 3 }),
    })

    expect(census.problems).toContainEqual(expect.objectContaining({ kind: 'stale-exception' }))

    rmSync(isolated, { recursive: true, force: true })
  })
})
