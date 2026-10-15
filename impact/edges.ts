/**
 * The edges no parser can find: data files, fixtures, and snapshot baselines.
 *
 * ---------------------------------------------------------------------------
 * Two kinds, and the difference matters
 * ---------------------------------------------------------------------------
 * **Conventional** edges are derivable, because a runner's own naming rule
 * says where the file is. A Vitest snapshot for `x/y.test.ts` lives at
 * `x/__snapshots__/y.test.ts.snap` whether or not anybody writes that down, so
 * `snapshotEdges` derives those and nobody maintains a list. The
 * `snapshot-baseline` fault in the matrix is the measurement of what deriving
 * them buys: a rewritten baseline fails its suite, and the import graph alone
 * selects nothing.
 *
 * **Declared** edges are the ones that have to be written by hand, because the
 * dependency lives inside a string literal that the code builds at run time:
 * `readFileSync(join(here, 'data/rates.json'))`, a directory of plugins loaded
 * by `readdir`, a seeded SQL file, a golden file for a parser. There is no
 * general way to find them — a scanner for string literals that look like
 * paths finds every log message with a slash in it and still misses a path
 * assembled from two variables — so the honest version of this is a list with
 * a reason per line, audited so it cannot rot.
 *
 * The cost of that list is the real argument against hand-maintained impact
 * analysis, and it should be stated rather than hidden: an edge nobody
 * declared is a suite nobody runs, and the failure is silent. `check.ts`
 * audits every declaration against the tree — a dependency glob matching
 * nothing, or an importer that does not exist, fails the gate — which catches
 * the edge that rots, and cannot catch the edge that was never written.
 */

import type { Graph } from './graph.ts'
import { matchesGlob } from './triggers.ts'

export interface DeclaredEdge {
  /** The file that reads the dependency. Exact path. */
  readonly importer: string
  /** What it reads. A glob, so a directory of fixtures is one line. */
  readonly dependency: string
  readonly why: string
}

/** This repository's declared non-import edges. */
export const REPO_EDGES: readonly DeclaredEdge[] = [
  {
    importer: 'flake/registry.ts',
    dependency: 'flake/quarantine.json',
    why: 'the quarantine registry is read from disk by path, not imported',
  },
  {
    importer: 'impact/runs.ts',
    dependency: 'impact/fixture/**',
    why: 'the measured subject is copied and run as files; nothing imports it',
  },
  {
    importer: 'lighthouse/load.ts',
    dependency: 'lighthouse/budgets.json',
    why: 'the budget table is read at call time so a test can point it elsewhere',
  },
  {
    importer: 'tdd/characterisation/goldenMaster.ts',
    dependency: 'tdd/characterisation/golden-master.json',
    why: 'the golden master is a recorded file, read by path',
  },
  {
    importer: 'pact/pipeline/readme.ts',
    dependency: 'pact/README.md',
    why: 'the README audit reads the document it audits',
  },
]

/** The fixture's declared edges: one data file, one plugin directory. */
export const FIXTURE_EDGES: readonly DeclaredEdge[] = [
  {
    importer: 'src/rates.ts',
    dependency: 'src/data/rates.json',
    why: 'read with readFileSync from a path built at run time',
  },
  {
    importer: 'src/rules/registry.ts',
    dependency: 'src/rules/*.rule.ts',
    why: 'loaded by readdir and a computed specifier: invisible to any parser',
  },
]

/** A resolved edge: both ends exist in the tree. */
export interface Edge {
  readonly importer: string
  readonly dependency: string
}

/**
 * Snapshot baselines, derived from Vitest's own naming rule.
 *
 * Both directions are checked: a `.snap` whose test file is gone is not an
 * edge, and is an obsolete baseline the snapshot gate already reports.
 */
export function snapshotEdges(files: readonly string[]): readonly Edge[] {
  const present = new Set(files)

  return files
    .filter((file) => file.endsWith('.snap'))
    .flatMap((snapshot) => {
      // `a/__snapshots__/b.test.ts.snap` → `a/b.test.ts`
      const test = snapshot.replace('/__snapshots__/', '/').replace(/\.snap$/, '')

      return present.has(test) ? [{ importer: test, dependency: snapshot }] : []
    })
    .sort((left, right) => left.dependency.localeCompare(right.dependency))
}

/** Expand the dependency globs of declared edges against the tree. */
export function expandEdges(declared: readonly DeclaredEdge[], files: readonly string[]): readonly Edge[] {
  return declared.flatMap((edge) =>
    files
      .filter((file) => file !== edge.importer && matchesGlob(file, edge.dependency))
      .map((file) => ({ importer: edge.importer, dependency: file })),
  )
}

/**
 * A copy of the graph with extra edges folded in.
 *
 * The dependency gains an importer, which is all reverse reachability needs:
 * a change to `data/rates.json` now reaches `rates.ts`, and from there the
 * ordinary walk reaches the test beside it.
 */
export function withEdges(graph: Graph, edges: readonly Edge[]): Graph {
  const imports = new Map<string, Set<string>>()
  const importers = new Map<string, Set<string>>()

  for (const file of graph.files) {
    imports.set(file, new Set(graph.imports.get(file) ?? []))
    importers.set(file, new Set(graph.importers.get(file) ?? []))
  }

  for (const edge of edges) {
    if (!imports.has(edge.importer) || !imports.has(edge.dependency)) continue

    imports.get(edge.importer)?.add(edge.dependency)
    importers.get(edge.dependency)?.add(edge.importer)
  }

  return { files: graph.files, imports, importers, external: graph.external }
}
