/**
 * Rendering the measurement as the tables `README.md` publishes.
 *
 * The document does not contain a table somebody typed. It contains the output
 * of these functions, and `readme.test.ts` compares the two as text — the
 * discipline `flake/`, `trace/` and `lighthouse/` established here. There is
 * no version of that test which agrees with a published table holding a wrong
 * cell.
 *
 * The findings below are held to the same standard in both directions: each is
 * a predicate over the measured matrix plus the heading the README must carry,
 * so a finding that stops being true fails the audit, and a heading with no
 * finding behind it fails too.
 */

import { FAULTS, FAULT_IDS, type FaultId } from './faults.ts'
import { GROUND_TRUTH, MATRIX, SUITES, TOTAL_SUITES, totalSelected, unsafeFaults } from './matrix.ts'
import { STRATEGIES, STRATEGY_IDS, type StrategyId } from './strategies.ts'

/** The versions every cell was measured against. */
export const MEASURED_AGAINST = 'Vitest 3.2.7 and TypeScript 6.0.3'

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`

const divider = (count: number): string => `|${'---|'.repeat(count)}`

/** Short column heads: the fault ids without their common words. */
const SHORT: Readonly<Record<FaultId, string>> = {
  'bulk-threshold': 'threshold',
  'scale-cents': 'deep module',
  'test-factory': 'helper',
  'runtime-rule': 'plugin',
  'rate-table': 'data file',
  'snapshot-baseline': 'snapshot',
  'setup-matcher': 'setup',
  'new-test': 'new test',
}

/** The fault catalogue: what was changed, and what broke when it was. */
export function renderFaults(): string {
  return [
    row(['fault', 'the change', 'suites broken', 'the dependency it travels along']),
    divider(4),
    ...FAULTS.map((fault) =>
      row([
        `\`${fault.id}\``,
        `\`${fault.change.file}\``,
        `${String(GROUND_TRUTH[fault.id].length)} of ${String(SUITES[fault.id])}`,
        fault.shape,
      ]),
    ),
  ].join('\n')
}

/** The strategy catalogue: the rule each row applies. */
export function renderStrategies(): string {
  return [
    row(['strategy', 'the rule']),
    divider(2),
    ...STRATEGIES.map((strategy) => row([`\`${strategy.id}\``, strategy.rule])),
  ].join('\n')
}

/**
 * The matrix: suites selected per fault, with a cross on the cells that missed
 * a suite that failed.
 *
 * `all` is the first row because every other row is a claim measured against
 * it, and the last two columns are the two numbers that decide a strategy —
 * how many faults it is unsafe on, and what it costs when it is not.
 */
export function renderMatrix(): string {
  return [
    row(['strategy', ...FAULT_IDS.map((fault) => SHORT[fault]), 'misses', 'suites run']),
    divider(FAULT_IDS.length + 3),
    ...STRATEGY_IDS.map((strategy) => {
      const unsafe = unsafeFaults(strategy)

      return row([
        `\`${strategy}\``,
        ...FAULT_IDS.map((fault) => {
          const cell = MATRIX[strategy][fault]

          return cell.safe ? String(cell.selected) : `${String(cell.selected)} ✗`
        }),
        unsafe.length === 0 ? '**none**' : `**${String(unsafe.length)}**`,
        `${String(totalSelected(strategy))}/${String(TOTAL_SUITES)}`,
      ])
    }),
  ].join('\n')
}

/** A claim the README makes, and the measurement it has to survive. */
export interface Finding {
  /** The heading the README must carry, verbatim. */
  readonly heading: string
  /** True when the measurement still supports it. */
  readonly holds: () => boolean
}

const share = (strategy: StrategyId): number => totalSelected(strategy) / TOTAL_SUITES

export const FINDINGS: readonly Finding[] = [
  {
    heading: 'Selecting nothing is the cheapest possible answer and it reports green',
    holds: () => unsafeFaults('changed-tests').length === 7 && totalSelected('changed-tests') === 1,
  },
  {
    heading: 'One hop of the import graph is not the import graph',
    holds: () =>
      !MATRIX['importers-direct']['bulk-threshold'].safe && MATRIX['importers-transitive']['bulk-threshold'].safe,
  },
  {
    heading: 'Everything the import graph misses is a dependency that is not an import',
    holds: () =>
      unsafeFaults('importers-transitive').join() ===
      ['runtime-rule', 'rate-table', 'snapshot-baseline', 'setup-matcher'].join(),
  },
  {
    heading: 'Coverage sees what ran, which is more than any parser can and less than enough',
    holds: () =>
      MATRIX.coverage['runtime-rule'].safe &&
      !MATRIX['importers-transitive']['runtime-rule'].safe &&
      !MATRIX.coverage['rate-table'].safe &&
      !MATRIX.coverage['snapshot-baseline'].safe &&
      !MATRIX.coverage['setup-matcher'].safe,
  },
  {
    heading: 'A coverage map is one run stale, and the fix is not the map',
    holds: () => !MATRIX.coverage['new-test'].safe && MATRIX['importers-transitive']['new-test'].safe,
  },
  {
    heading: 'Co-location flatters the cheapest heuristic',
    holds: () =>
      unsafeFaults('same-directory').length === 4 && totalSelected('same-directory') > totalSelected('coverage'),
  },
  {
    heading: 'The safe selector still runs two suites in five',
    holds: () => unsafeFaults('transitive-triggers-edges').length === 0 && share('transitive-triggers-edges') > 0.4,
  },
  {
    heading: 'Nothing here can find an edge nobody declared',
    holds: () => MATRIX['transitive-triggers-edges']['rate-table'].safe && !MATRIX['importers-transitive']['rate-table'].safe,
  },
]
