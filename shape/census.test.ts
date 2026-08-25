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
    // `pact/provider/...` is the one file where zero is correct, because its
    // suite is `it.skipIf(!PROVIDER_BASE_URL)` and `vitest list` omits skipped
    // tests. Anything else at zero is a broken include glob.
    expect(EXPECTED_EMPTY).toEqual(['pact/provider/users.provider.pact.verify.test.ts'])
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
