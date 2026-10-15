// @vitest-environment node
//
// Points the selector at this repository rather than at the fixture. The
// fixture measures what selection *misses*; this file checks that the thing
// doing the selecting agrees with the repository it is pointed at — the suite
// list, the alias, the declared edges and the triggers.

import { describe, expect, it } from 'vitest'

import { matchesGlob } from './triggers.ts'
import {
  auditConfiguration,
  DEFAULT_STRATEGY,
  INCLUDE_PATTERNS,
  repoGraph,
  repoSelection,
  trackedFiles,
  unitTestFiles,
} from './repo.ts'

// Parsed once: 700-odd files through the compiler's scanner is fast, and
// fifteen times is not.
const files = trackedFiles()
const graph = repoGraph(files)
const suites = unitTestFiles(files)

describe('the tracked tree', () => {
  it('is read from git rather than walked, so it holds no build output', () => {
    expect(files).toContain('package.json')
    expect(files.filter((file) => file.startsWith('coverage/') || file.startsWith('impact/.runs/'))).toEqual([])
  })

  it('parses with no file failing, which a silent skip would hide', () => {
    expect(graph.files).toHaveLength(files.length)
  })
})

describe('the suite list', () => {
  it('holds the unit suites', () => {
    expect(suites).toContain('flake/history.test.ts')
    expect(suites).toContain('impact/select.test.ts')
  })

  // Every one of these is excluded by `vitest.config.ts`, and this file reads
  // that config rather than restating its globs. `check.ts` cross-checks the
  // result against `vitest list`.
  it('excludes the suites that belong to another runner', () => {
    expect(suites.filter((suite) => suite.startsWith('pact/'))).toEqual([])
    expect(suites.filter((suite) => suite.startsWith('playwright/'))).toEqual([])
    expect(suites.filter((suite) => suite.endsWith('.container.test.ts'))).toEqual([])
  })

  it('excludes the impact fixture, which is a subject rather than a suite', () => {
    expect(suites.filter((suite) => suite.startsWith('impact/fixture/'))).toEqual([])
  })

  it('holds only files the include patterns match', () => {
    expect(suites.filter((suite) => !INCLUDE_PATTERNS.some((pattern) => matchesGlob(suite, pattern)))).toEqual([])
  })
})

describe('the repository graph', () => {
  it('resolves an alias import, which no relative path would find', () => {
    expect([...(graph.imports.get('vitest/flaky.ts') ?? [])]).toContain('flake/quarantine.ts')
  })

  // The audit with teeth. An unresolved relative specifier is a broken import:
  // either the file moved and nothing noticed, or the resolver cannot see a
  // form this repository uses — and in the second case every selection
  // through that file is quietly short.
  it('resolves every relative specifier in the repository', () => {
    const broken = [...graph.external.entries()].flatMap(([file, specifiers]) =>
      specifiers.filter((specifier) => specifier.startsWith('.')).map((specifier) => `${file} → ${specifier}`),
    )

    expect(broken).toEqual([])
  })

  it('records packages and node builtins as external rather than as edges', () => {
    expect(graph.external.get('impact/graph.ts')).toContain('typescript')
  })
})

describe('the selector against this repository', () => {
  it('reports no stale trigger and no stale declared edge', () => {
    expect(auditConfiguration(files)).toEqual([])
  })

  it('runs everything when the manifest changes', () => {
    expect(repoSelection([{ path: 'package.json', status: 'modified' }], files).ranAll).toBe(true)
  })

  it('selects a suite through the snapshot edge it derives', () => {
    expect(
      repoSelection([{ path: 'snapshot/__snapshots__/full.test.ts.snap', status: 'modified' }], files).suites,
    ).toContain('snapshot/full.test.ts')
  })

  it('selects the suite that reads a declared data file', () => {
    // `flake/registry.ts` reads the file by path. Nothing imports the JSON, so
    // without the declared edge this selection is empty — and the two suites
    // that assert against the real registry would not run.
    expect(repoSelection([{ path: 'flake/quarantine.json', status: 'modified' }], files).suites).toEqual([
      'flake/quarantine.test.ts',
      'vitest/flaky.test.ts',
    ])
  })

  it('selects the suite beside a changed module, and nothing that is not a suite', () => {
    const selection = repoSelection([{ path: 'flake/history.ts', status: 'modified' }], files)

    expect(selection.suites).toContain('flake/history.test.ts')
    expect(selection.suites.filter((suite) => !suites.includes(suite))).toEqual([])
  })

  // The claim the README makes about this repository, as an inequality rather
  // than a number: a one-module change selects a small fraction of 200-odd
  // suites. The exact count moves whenever the repository grows, and
  // `pnpm impact:check` prints it.
  it('selects well under a tenth of the suite for a single-module change', () => {
    const selection = repoSelection([{ path: 'flake/history.ts', status: 'modified' }], files)

    expect(selection.ranAll).toBe(false)
    expect(selection.suites.length).toBeLessThan(suites.length / 10)
    expect(selection.suites.length).toBeGreaterThan(0)
  })

  it('selects nothing for a documentation-only change, and does not call that a full run', () => {
    const selection = repoSelection([{ path: 'README.md', status: 'modified' }], files)

    expect(selection.ranAll).toBe(false)
    expect(selection.suites).toEqual([])
  })

  it('defaults to the one strategy the matrix found safe on every fault', () => {
    expect(DEFAULT_STRATEGY).toBe('transitive-triggers-edges')
  })
})
