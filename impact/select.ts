/**
 * The selector: a diff, a graph, and eight ways to turn them into a list of
 * suites to run.
 *
 * ---------------------------------------------------------------------------
 * The failure mode worth designing against
 * ---------------------------------------------------------------------------
 * A test-impact selector that is wrong does not fail. It selects fewer suites
 * than it should, every one of them passes, and the pull request is green —
 * so the cost of a missing edge is not a red build to investigate but a bug
 * that reaches the default branch with a green check beside it. That asymmetry
 * decides every judgement call in this file:
 *
 *   - Over-selection is a cost. Under-selection is a defect.
 *   - A changed file that resolves to nothing in the graph is a reason to run
 *     everything, not a reason to select nothing.
 *   - A deleted or renamed path cannot be analysed from the working tree at
 *     all — its importers are exactly the files that no longer compile — so it
 *     runs everything too.
 *   - A selection is never empty when the diff is non-empty *and* nothing in
 *     it was understood. "I found no affected suites" and "I did not
 *     understand this diff" must not produce the same answer.
 *
 * `select` therefore returns a `ranAll` flag and the reasons for it, and
 * `check.ts` prints them: a full run that nobody can explain is how a project
 * stops trusting the mechanism and turns it off.
 */

import { changedPaths, vanishedPaths, type ChangedFile } from './diff.ts'
import { expandEdges, snapshotEdges, withEdges, type DeclaredEdge } from './edges.ts'
import { directoryOf, reverseReachable, type Graph } from './graph.ts'
import { selectByCoverage, type CoverageMap } from './coverage.ts'
import { firedTriggers, type Trigger } from './triggers.ts'
import type { StrategyId } from './strategies.ts'

export interface SelectionInput {
  readonly graph: Graph
  /** Every test file the suite would run, repository-relative. */
  readonly testFiles: readonly string[]
  readonly changed: readonly ChangedFile[]
  readonly triggers?: readonly Trigger[]
  readonly edges?: readonly DeclaredEdge[]
  readonly coverage?: CoverageMap
}

export interface Selection {
  readonly strategy: StrategyId
  /** The suites to run, sorted. Equal to every test file when `ranAll`. */
  readonly suites: readonly string[]
  readonly ranAll: boolean
  /** Why everything is running, or why a selection was possible. One line each. */
  readonly reasons: readonly string[]
}

const sorted = (files: Iterable<string>): readonly string[] => [...new Set(files)].sort()

/** Paths in the diff that the graph has no node for: new assets, docs, anything untracked by it. */
function unknownToGraph(graph: Graph, paths: readonly string[]): readonly string[] {
  const present = new Set(graph.files)

  return paths.filter((path) => !present.has(path))
}

function runEverything(strategy: StrategyId, testFiles: readonly string[], reasons: readonly string[]): Selection {
  return { strategy, suites: sorted(testFiles), ranAll: true, reasons }
}

export function select(strategyId: StrategyId, input: SelectionInput): Selection {
  const { graph, testFiles, changed } = input
  const tests = new Set(testFiles)
  const changedNow = changedPaths(changed)
  const vanished = vanishedPaths(changed)

  if (strategyId === 'all') {
    return runEverything('all', testFiles, ['the strategy is to run everything'])
  }

  if (changed.length === 0) {
    return { strategy: strategyId, suites: [], ranAll: false, reasons: ['the diff is empty'] }
  }

  if (strategyId === 'changed-tests') {
    return {
      strategy: strategyId,
      suites: sorted(changedNow.filter((path) => tests.has(path))),
      ranAll: false,
      reasons: ['only the test files in the diff'],
    }
  }

  if (strategyId === 'same-directory') {
    const directories = new Set(changedNow.map(directoryOf))

    return {
      strategy: strategyId,
      suites: sorted(testFiles.filter((test) => directories.has(directoryOf(test)))),
      ranAll: false,
      reasons: [...directories].sort().map((directory) => `tests in ${directory === '' ? '<root>' : directory}/`),
    }
  }

  if (strategyId === 'coverage') {
    const map = input.coverage

    // An empty map and no map are the same state of knowledge, and neither is
    // a reason to select nothing: a first run on a fresh checkout has no
    // recorded coverage, and a selector that reads that as "no suites are
    // affected" skips the whole suite on the one run that has never passed.
    if (map === undefined || map.size === 0) {
      return runEverything(strategyId, testFiles, ['no coverage map was recorded: nothing to select from'])
    }

    return {
      strategy: strategyId,
      suites: sorted(selectByCoverage(map, changedNow)),
      ranAll: false,
      reasons: [`${String(map.size)} test files have a recorded coverage map`],
    }
  }

  // The three graph strategies. Only the last two consult triggers and edges,
  // which is what their rows in the matrix are measuring.
  const consultsTriggers = strategyId === 'transitive-triggers' || strategyId === 'transitive-triggers-edges'
  const consultsEdges = strategyId === 'transitive-triggers-edges'

  if (consultsTriggers) {
    const reasons: string[] = []
    const fired = firedTriggers(changedNow, input.triggers ?? [])

    for (const trigger of fired) reasons.push(`${trigger.id} (${trigger.pattern}): ${trigger.why}`)

    if (vanished.length > 0) {
      reasons.push(
        `${String(vanished.length)} path(s) no longer exist (${vanished.join(', ')}): their importers cannot be found in the working tree`,
      )
    }

    const unknown = unknownToGraph(graph, changedNow)

    if (unknown.length > 0) {
      reasons.push(`${String(unknown.length)} changed path(s) are not nodes in the graph (${unknown.join(', ')})`)
    }

    if (reasons.length > 0) return runEverything(strategyId, testFiles, reasons)
  }

  const walked = consultsEdges
    ? withEdges(graph, [...snapshotEdges(graph.files), ...expandEdges(input.edges ?? [], graph.files)])
    : graph

  const depth = strategyId === 'importers-direct' ? 1 : Number.POSITIVE_INFINITY
  const reachable = reverseReachable(walked, changedNow, depth)

  return {
    strategy: strategyId,
    suites: sorted([...reachable].filter((file) => tests.has(file))),
    ranAll: false,
    reasons: [
      `${String(changedNow.length)} changed file(s) reach ${String(reachable.size)} file(s) in the graph`,
    ],
  }
}
