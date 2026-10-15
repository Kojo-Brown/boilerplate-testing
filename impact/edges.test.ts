// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { expandEdges, FIXTURE_EDGES, REPO_EDGES, snapshotEdges, withEdges } from './edges.ts'
import { buildGraph, reverseReachable } from './graph.ts'
import { FIXTURE_ROOT, treeFiles } from './runs.ts'

const fixtureGraph = () => {
  const files = treeFiles(FIXTURE_ROOT)

  return { files, graph: buildGraph(FIXTURE_ROOT, files) }
}

describe('snapshot edges', () => {
  it('derive the test file a baseline belongs to', () => {
    expect(snapshotEdges(['a/__snapshots__/b.test.ts.snap', 'a/b.test.ts'])).toEqual([
      { importer: 'a/b.test.ts', dependency: 'a/__snapshots__/b.test.ts.snap' },
    ])
  })

  // An orphaned baseline is a finding for the snapshot gate, not an edge: it
  // has no test to select.
  it('derive nothing for a baseline whose test file is gone', () => {
    expect(snapshotEdges(['a/__snapshots__/b.test.ts.snap'])).toEqual([])
  })

  it('derive the fixture baseline without anyone declaring it', () => {
    const { files } = fixtureGraph()

    expect(snapshotEdges(files)).toEqual([
      { importer: 'src/label.test.ts', dependency: 'src/__snapshots__/label.test.ts.snap' },
    ])
  })
})

describe('expanding a declared edge', () => {
  it('expands a glob to every file it matches', () => {
    expect(
      expandEdges(
        [{ importer: 'a/loader.ts', dependency: 'a/*.rule.ts', why: 'loaded by readdir' }],
        ['a/loader.ts', 'a/one.rule.ts', 'a/two.rule.ts', 'a/other.ts'],
      ),
    ).toEqual([
      { importer: 'a/loader.ts', dependency: 'a/one.rule.ts' },
      { importer: 'a/loader.ts', dependency: 'a/two.rule.ts' },
    ])
  })

  it('never makes a file depend on itself', () => {
    expect(
      expandEdges([{ importer: 'a/x.ts', dependency: 'a/*.ts', why: 'self' }], ['a/x.ts', 'a/y.ts']),
    ).toEqual([{ importer: 'a/x.ts', dependency: 'a/y.ts' }])
  })

  it('expands to nothing when the glob matches nothing, which the gate reports', () => {
    expect(expandEdges([{ importer: 'a/x.ts', dependency: 'a/gone/*.json', why: 'stale' }], ['a/x.ts'])).toEqual([])
  })
})

describe('folding edges into a graph', () => {
  it('gives a data file the importer that reads it', () => {
    const { graph, files } = fixtureGraph()
    const widened = withEdges(graph, expandEdges(FIXTURE_EDGES, files))

    expect([...(widened.importers.get('src/data/rates.json') ?? [])]).toEqual(['src/rates.ts'])
  })

  it('makes a data file reach the suite that depends on it', () => {
    const { graph, files } = fixtureGraph()
    const widened = withEdges(graph, expandEdges(FIXTURE_EDGES, files))

    expect([...reverseReachable(widened, ['src/data/rates.json'])]).toContain('src/rates.test.ts')
  })

  it('makes a runtime-loaded rule reach the suite that loads it', () => {
    const { graph, files } = fixtureGraph()
    const widened = withEdges(graph, expandEdges(FIXTURE_EDGES, files))

    expect([...reverseReachable(widened, ['src/rules/bulk.rule.ts'])]).toContain('src/rules/registry.test.ts')
  })

  it('leaves the original graph untouched, so one widening cannot leak into another', () => {
    const { graph, files } = fixtureGraph()

    withEdges(graph, expandEdges(FIXTURE_EDGES, files))

    expect([...(graph.importers.get('src/data/rates.json') ?? [])]).toEqual([])
  })

  it('ignores an edge whose ends are not both in the tree', () => {
    const { graph } = fixtureGraph()
    const widened = withEdges(graph, [{ importer: 'src/rates.ts', dependency: 'src/data/gone.json' }])

    expect([...(widened.imports.get('src/rates.ts') ?? [])]).not.toContain('src/data/gone.json')
  })
})

describe('the declared edges', () => {
  it('carry a reason each, because a hand-written list is the cost of the technique', () => {
    expect([...REPO_EDGES, ...FIXTURE_EDGES].filter((edge) => edge.why.trim() === '')).toEqual([])
  })

  it('name an importer and a dependency that are not the same file', () => {
    expect([...REPO_EDGES, ...FIXTURE_EDGES].filter((edge) => edge.importer === edge.dependency)).toEqual([])
  })
})
