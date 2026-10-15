/**
 * The eight ways to answer "which suites does this diff affect?", as a table.
 *
 * They are ordered by how much they know, and the matrix in `README.md` scores
 * every one of them against every fault in `faults.ts`. Six of the eight are
 * things real projects do; two of the six are things real projects do and
 * should not.
 */

export const STRATEGY_IDS = [
  'all',
  'changed-tests',
  'same-directory',
  'importers-direct',
  'importers-transitive',
  'transitive-triggers',
  'transitive-triggers-edges',
  'coverage',
] as const

export type StrategyId = (typeof STRATEGY_IDS)[number]

export interface Strategy {
  readonly id: StrategyId
  /** The one-line rule. */
  readonly rule: string
  /** Where it comes from, and what it is worth knowing about. */
  readonly note: string
}

export const STRATEGIES: readonly Strategy[] = [
  {
    id: 'all',
    rule: 'run every suite',
    note: 'The baseline, and the only strategy that is safe by construction. Every row below is a claim about what can be skipped, and this row is what the claim is measured against.',
  },
  {
    id: 'changed-tests',
    rule: 'run the test files that appear in the diff',
    note: '"Run what changed", taken literally. It is the selection a `git diff --name-only | grep test` pipeline produces, and it skips every suite whose subject changed — which is nearly all of them.',
  },
  {
    id: 'same-directory',
    rule: 'run the test files in the directory of a changed file',
    note: 'The heuristic co-location invites: the test is next to the code, so change the code and run the neighbours. It over-selects inside a directory and misses everything one directory away.',
  },
  {
    id: 'importers-direct',
    rule: 'run the test files that import a changed file',
    note: 'One hop of the import graph. Correct for a leaf module with a test beside it, wrong the moment anything is layered — a change to a module that a *helper* imports reaches no test at all.',
  },
  {
    id: 'importers-transitive',
    rule: 'run the test files that reach a changed file through any chain of imports',
    note: 'The real graph strategy, and the first one that is not obviously wrong. Everything it misses, it misses because the dependency was not an import.',
  },
  {
    id: 'transitive-triggers',
    rule: 'as above, and run everything when a changed file is a config, setup, manifest or lockfile',
    note: 'The escape hatch from `triggers.ts`. It converts the largest class of silent miss into a full run.',
  },
  {
    id: 'transitive-triggers-edges',
    rule: 'as above, over a graph that also carries derived snapshot edges and declared data-file edges',
    note: 'The recommended selector. The snapshot edges are derived from the naming rule of the runner and cost nothing to keep; the data-file edges are a hand-written list, and that list is the maintenance price of the whole technique.',
  },
  {
    id: 'coverage',
    rule: 'run the test files whose last recorded coverage includes a changed file',
    note: 'What the serious tools do: it observes what executed, so it sees dependencies no parser can. It is also one run stale, blind to data files, and blind to anything outside its own include list.',
  },
]

const BY_ID = new Map(STRATEGIES.map((strategy) => [strategy.id, strategy]))

export function strategy(id: StrategyId): Strategy {
  const found = BY_ID.get(id)

  if (found === undefined) throw new Error(`unknown strategy: ${id}`)

  return found
}
