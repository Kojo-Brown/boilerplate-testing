// @vitest-environment node

import { describe, expect, it } from 'vitest'

import type { CoverageMap } from './coverage.ts'
import type { ChangedFile } from './diff.ts'
import { FIXTURE_EDGES } from './edges.ts'
import { buildGraph } from './graph.ts'
import { FIXTURE_ROOT, isTestFile, treeFiles } from './runs.ts'
import { select } from './select.ts'
import { FIXTURE_TRIGGERS } from './triggers.ts'

const files = treeFiles(FIXTURE_ROOT)
const graph = buildGraph(FIXTURE_ROOT, files)
const testFiles = files.filter(isTestFile)

const on = (changed: readonly ChangedFile[], coverage?: CoverageMap) =>
  ({ graph, testFiles, changed, triggers: FIXTURE_TRIGGERS, edges: FIXTURE_EDGES, ...(coverage ? { coverage } : {}) })

const modified = (...paths: readonly string[]): readonly ChangedFile[] =>
  paths.map((path) => ({ path, status: 'modified' as const }))

describe('the empty diff', () => {
  it('selects nothing for every strategy that is not `all`', () => {
    expect(select('importers-transitive', on([])).suites).toEqual([])
  })

  it('still runs everything under `all`, which does not consult the diff', () => {
    expect(select('all', on([])).suites).toEqual(testFiles)
  })
})

describe('the `all` strategy', () => {
  it('selects every suite and says so', () => {
    const selection = select('all', on(modified('src/money.ts')))

    expect(selection.ranAll).toBe(true)
    expect(selection.suites).toEqual(testFiles)
  })
})

describe('the transitive-importers strategy', () => {
  it('selects the suites that reach a changed module through any chain', () => {
    expect(select('importers-transitive', on(modified('src/pricing.ts'))).suites).toEqual([
      'src/cart.test.ts',
      'src/pricing.test.ts',
    ])
  })

  it('selects a changed test file itself, with no special case for it', () => {
    expect(select('importers-transitive', on(modified('src/rates.test.ts'))).suites).toEqual(['src/rates.test.ts'])
  })

  it('selects nothing for a data file, which is the miss the matrix records', () => {
    expect(select('importers-transitive', on(modified('src/data/rates.json'))).suites).toEqual([])
  })

  it('never reports a full run, because it has no rule that could produce one', () => {
    expect(select('importers-transitive', on(modified('setup.ts'))).ranAll).toBe(false)
  })
})

describe('the depth-1 strategy', () => {
  it('selects only the suites that import the changed file directly', () => {
    expect(select('importers-direct', on(modified('src/pricing.ts'))).suites).toEqual(['src/pricing.test.ts'])
  })
})

describe('the same-directory strategy', () => {
  it('selects every suite beside a changed file, including ones that do not use it', () => {
    expect(select('same-directory', on(modified('src/money.ts'))).suites).toEqual([
      'src/cart.test.ts',
      'src/label.test.ts',
      'src/money.test.ts',
      'src/pricing.test.ts',
      'src/rates.test.ts',
    ])
  })

  it('selects nothing when the changed file sits in a directory with no suites', () => {
    expect(select('same-directory', on(modified('src/support/factory.ts'))).suites).toEqual([])
  })
})

describe('the changed-tests strategy', () => {
  it('selects nothing when the diff contains no test file', () => {
    expect(select('changed-tests', on(modified('src/money.ts'))).suites).toEqual([])
  })

  it('selects the test files the diff does contain', () => {
    expect(select('changed-tests', on(modified('src/money.test.ts'))).suites).toEqual(['src/money.test.ts'])
  })
})

describe('triggers', () => {
  it('turn a setup-file change into a full run, naming the reason', () => {
    const selection = select('transitive-triggers', on(modified('setup.ts')))

    expect(selection.ranAll).toBe(true)
    expect(selection.suites).toEqual(testFiles)
    expect(selection.reasons.join(' ')).toContain('fixture-setup')
  })

  it('turn a config change into a full run', () => {
    expect(select('transitive-triggers', on(modified('vitest.config.ts'))).ranAll).toBe(true)
  })

  it('leave an ordinary source change to the graph', () => {
    expect(select('transitive-triggers', on(modified('src/pricing.ts'))).ranAll).toBe(false)
  })
})

// The three rules the fault catalogue deliberately does not measure, because
// each one produces a full run and measuring a full run against a full run
// establishes nothing. They are the difference between "no suites are
// affected" and "this diff was not understood", and they are the reason a
// selection is never silently empty.
describe('a diff the selector cannot analyse', () => {
  it('runs everything when a file was deleted, because its importers are only in the old tree', () => {
    const selection = select('transitive-triggers', on([{ path: 'src/gone.ts', status: 'deleted' }]))

    expect(selection.ranAll).toBe(true)
    expect(selection.reasons.join(' ')).toContain('no longer exist')
  })

  it('runs everything for the source side of a rename', () => {
    const selection = select(
      'transitive-triggers',
      on([{ path: 'src/renamed.ts', status: 'renamed', from: 'src/money.ts' }]),
    )

    expect(selection.ranAll).toBe(true)
    expect(selection.reasons.join(' ')).toContain('src/money.ts')
  })

  it('runs everything when a changed path is not a node in the graph at all', () => {
    const selection = select('transitive-triggers', on(modified('src/brand-new.ts')))

    expect(selection.ranAll).toBe(true)
    expect(selection.reasons.join(' ')).toContain('not nodes in the graph')
  })

  it('selects normally when every changed path is understood', () => {
    expect(select('transitive-triggers', on(modified('src/money.ts'))).ranAll).toBe(false)
  })
})

describe('the recommended strategy', () => {
  it('reaches a suite through a declared data-file edge', () => {
    expect(select('transitive-triggers-edges', on(modified('src/data/rates.json'))).suites).toEqual([
      'src/rates.test.ts',
    ])
  })

  it('reaches a suite through a derived snapshot edge', () => {
    expect(
      select('transitive-triggers-edges', on(modified('src/__snapshots__/label.test.ts.snap'))).suites,
    ).toEqual(['src/label.test.ts'])
  })

  it('reaches a suite through a rule file no import statement names', () => {
    expect(select('transitive-triggers-edges', on(modified('src/rules/bulk.rule.ts'))).suites).toEqual([
      'src/rules/registry.test.ts',
    ])
  })
})

describe('the coverage strategy', () => {
  const map: CoverageMap = new Map([
    ['src/money.test.ts', new Set(['src/money.ts'])],
    ['src/cart.test.ts', new Set(['src/money.ts', 'src/pricing.ts', 'src/cart.ts'])],
  ])

  it('selects the suites whose recorded run touched a changed file', () => {
    expect(select('coverage', on(modified('src/pricing.ts'), map)).suites).toEqual(['src/cart.test.ts'])
  })

  it('selects nothing for a file no recorded run touched', () => {
    expect(select('coverage', on(modified('src/rates.ts'), map)).suites).toEqual([])
  })

  // A selector with no map is not a selector that selects nothing. The
  // distinction is the whole of `ranAll`.
  it('runs everything when no map has been recorded', () => {
    const selection = select('coverage', on(modified('src/money.ts')))

    expect(selection.ranAll).toBe(true)
    expect(selection.reasons.join(' ')).toContain('no coverage map')
  })

  // The same state of knowledge, reached a different way: a fresh checkout
  // whose first run has not happened yet has a map with nothing in it.
  it('runs everything when the map is empty rather than absent', () => {
    expect(select('coverage', on(modified('src/money.ts'), new Map())).ranAll).toBe(true)
  })
})

describe('every strategy', () => {
  it('returns suites that are sorted and free of duplicates', () => {
    const selection = select('importers-transitive', on(modified('src/money.ts', 'src/money.ts', 'src/pricing.ts')))

    expect(selection.suites).toEqual([...new Set(selection.suites)].sort())
  })

  it('returns only files the suite actually contains', () => {
    const selection = select('transitive-triggers-edges', on(modified('src/money.ts')))

    expect(selection.suites.filter((suite) => !testFiles.includes(suite))).toEqual([])
  })
})
