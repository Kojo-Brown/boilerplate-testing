/**
 * The isolation table: what each strategy costs, and what it lets through.
 *
 * Declared here and re-derived by `runs.test.ts` — ten real `playwright test`
 * runs against a real origin — on every run of `pnpm test`. As with
 * `capture.ts`, nothing here is generated from the measurement and nothing in
 * the measurement is generated from here.
 *
 * Three hazards and two costs, and the split is deliberate. A hazard is
 * something that can make a suite report the wrong answer; a cost is something
 * that makes it slower or noisier. Putting them in one score would let a
 * strategy buy a hazard back with a cheap login, which is precisely the trade
 * this table exists to make visible rather than to make for the reader.
 */

import { STRATEGY_KEYS } from './strategies.ts'

/** The three questions a run answers about a strategy. */
export const HAZARDS = ['session-eviction', 'parallel-mutation', 'restart-inheritance'] as const

export type Hazard = (typeof HAZARDS)[number]

/**
 * Every verdict each hazard may return.
 *
 * `parallel-mutation` has three rather than two, and the third is not a shade
 * of the other two: `unreachable` means the hazard could not be posed, because
 * a worker that has been signed out cannot collide with anything. It is
 * reported separately so that a strategy cannot earn a clean cell by failing
 * the column next to it — see `derive.ts`.
 */
export const HAZARD_VERDICTS: Readonly<Record<Hazard, readonly string[]>> = {
  'session-eviction': ['evicted', 'survives'],
  'parallel-mutation': ['collided', 'unreachable', 'isolated'],
  'restart-inheritance': ['inherited', 'fresh'],
}

/** The one verdict per hazard that means the strategy came through it. */
export const CLEAN_VERDICT: Readonly<Record<Hazard, string>> = {
  'session-eviction': 'survives',
  'parallel-mutation': 'isolated',
  'restart-inheritance': 'fresh',
}

export interface HazardDefinition {
  readonly key: Hazard
  readonly asks: string
  readonly reads: string
  readonly matters: string
}

export const HAZARD_DEFINITIONS: readonly HazardDefinition[] = [
  {
    key: 'session-eviction',
    asks: 'Does one worker signing in end another worker\'s session?',
    reads: 'A ledger row whose `GET /api/me` answered 401.',
    matters:
      'Any server that keeps one live session per account does this, and most do. The ' +
      'symptom is a 401 in the middle of a suite that passed yesterday, attributed to ' +
      '"flakiness" because it lands on whichever test was unlucky.',
  },
  {
    key: 'parallel-mutation',
    asks: 'Does a worker read data a different worker wrote?',
    reads: 'A ledger row whose notes contain the other spec\'s marker.',
    matters:
      'The failure people already know about, and the one every "one account per worker" ' +
      'recipe is sold on. It is also the only one of the three that a careful test author ' +
      'can work around by asserting on nothing shared.',
  },
  {
    key: 'restart-inheritance',
    asks:
      'When a failed test discards a worker, does its replacement resume the dead worker\'s ' +
      'account?',
    reads:
      'Two ledger rows at the same `parallelIndex` with different `workerIndex` values and ' +
      'the same account.',
    matters:
      'The one nobody writes about. It only happens after a test has already failed, which ' +
      'is when the suite is being read most carefully and trusted least — and it turns the ' +
      'retry of a failed test into a test running against a dirtier account than the ' +
      'attempt that failed.',
  },
]

/** One strategy's three verdicts and two costs. */
export interface IsolationRow {
  readonly 'session-eviction': string
  readonly 'parallel-mutation': string
  readonly 'restart-inheritance': string
  /** `POST /api/login` calls across both phases. */
  readonly logins: number
  /** Distinct accounts used across both phases. */
  readonly accounts: number
}

/**
 * The measured table.
 *
 * The row to read twice is `per-parallel-index`: it is the only one where
 * `parallel-mutation` reads `isolated` and `restart-inheritance` reads
 * `inherited`. Everything else is either isolated on both or shared on both, so
 * that single row is the whole finding — a recipe that delivers the isolation
 * it is famous for and loses it in the one circumstance it was never tested in.
 *
 * The cost columns count both phases: two tests in the parallel run and four
 * attempts (three tests, one retried) in the restart run.
 */
export const EXPECTED_ISOLATION: Readonly<Record<string, IsolationRow>> = {
  'shared-lazy': {
    'session-eviction': 'evicted',
    'parallel-mutation': 'unreachable',
    'restart-inheritance': 'inherited',
    logins: 4,
    accounts: 2,
  },
  'shared-file': {
    'session-eviction': 'survives',
    'parallel-mutation': 'collided',
    'restart-inheritance': 'inherited',
    logins: 2,
    accounts: 2,
  },
  'per-parallel-index': {
    'session-eviction': 'survives',
    'parallel-mutation': 'isolated',
    'restart-inheritance': 'inherited',
    logins: 3,
    accounts: 3,
  },
  'per-worker-index': {
    'session-eviction': 'survives',
    'parallel-mutation': 'isolated',
    'restart-inheritance': 'fresh',
    logins: 4,
    accounts: 4,
  },
  'per-test': {
    'session-eviction': 'survives',
    'parallel-mutation': 'isolated',
    'restart-inheritance': 'fresh',
    logins: 6,
    accounts: 5,
  },
}

/** How many of the three hazards a strategy comes through cleanly. */
export function hazardsCleared(
  strategy: string,
  table: Readonly<Record<string, IsolationRow>> = EXPECTED_ISOLATION,
): number {
  const row = table[strategy]

  if (row === undefined) {
    throw new Error(`No isolation row for strategy ${JSON.stringify(strategy)}`)
  }

  return HAZARDS.filter((hazard) => row[hazard] === CLEAN_VERDICT[hazard]).length
}

/** The hazards on which two strategies disagree, in table order. */
export function isolationDifferences(
  left: string,
  right: string,
  table: Readonly<Record<string, IsolationRow>> = EXPECTED_ISOLATION,
): Hazard[] {
  return HAZARDS.filter((hazard) => table[left]?.[hazard] !== table[right]?.[hazard])
}

/** Structural checks the table must satisfy before any finding is read off it. */
export function isolationProblems(
  table: Readonly<Record<string, IsolationRow>> = EXPECTED_ISOLATION,
): string[] {
  const problems: string[] = []

  for (const strategy of Object.keys(table)) {
    if (!STRATEGY_KEYS.includes(strategy)) {
      problems.push(`${strategy} has an isolation row but is not a strategy in strategies.ts`)
    }
  }

  for (const strategy of STRATEGY_KEYS) {
    const row = table[strategy]

    if (row === undefined) {
      problems.push(`${strategy} is a strategy with no isolation row`)

      continue
    }

    for (const hazard of HAZARDS) {
      const allowed = HAZARD_VERDICTS[hazard]

      if (!allowed.includes(row[hazard])) {
        problems.push(
          `the ${strategy} row answers ${hazard} with ${row[hazard]}, which is not one of ` +
            `${allowed.join(' / ')}`,
        )
      }
    }

    if (!Number.isInteger(row.logins) || row.logins < 0) {
      problems.push(`the ${strategy} row has a non-integer login count`)
    }

    if (!Number.isInteger(row.accounts) || row.accounts < 1) {
      problems.push(`the ${strategy} row uses fewer than one account`)
    }
  }

  return problems
}
