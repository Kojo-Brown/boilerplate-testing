/**
 * The findings, as functions over the two tables.
 *
 * Each one is a sentence somebody might quote from `README.md`, restated as a
 * predicate that reads the table rather than a constant that agrees with it.
 * `findings.test.ts` asserts every predicate and `readme.test.ts` requires the
 * README to carry a paragraph for each — so a cell that moves either takes the
 * prose with it or fails the build, which is the only arrangement in which
 * documentation stays true by construction rather than by diligence.
 *
 * The `id` is what the README audit matches on, and the `claim` is the sentence
 * in the reader's terms. Neither is derived from the other.
 */

import {
  captureColumn,
  captureDifferences,
  EXPECTED_CAPTURE,
  gatesPassed,
  type CaptureRow,
} from './capture.ts'
import {
  CLEAN_VERDICT,
  EXPECTED_ISOLATION,
  HAZARDS,
  hazardsCleared,
  isolationDifferences,
  type IsolationRow,
} from './isolation.ts'
import { PROBES } from './probes.ts'
import { STRATEGY_KEYS } from './strategies.ts'
import { WIRING_KEYS } from './wirings.ts'

/**
 * The pair of tables a finding reads.
 *
 * Passed in rather than imported inside each predicate, so `findings.test.ts`
 * can hand a finding a table with one cell moved and check that it notices. A
 * predicate closed over the module's own constants cannot be perturbed, and a
 * predicate that cannot be perturbed cannot be shown to read anything.
 */
export interface Tables {
  readonly capture: Readonly<Record<string, CaptureRow>>
  readonly isolation: Readonly<Record<string, IsolationRow>>
}

export const MEASURED: Tables = { capture: EXPECTED_CAPTURE, isolation: EXPECTED_ISOLATION }

export interface Finding {
  readonly id: string
  readonly half: 'capture' | 'isolation'
  readonly claim: string
  /**
   * An exact phrase `README.md` must carry for this finding.
   *
   * Short, and quoted from the prose rather than generated from `claim`: a test
   * requiring the README to contain the whole claim would make this file the
   * README, and then neither is a check on the other. A phrase is enough to
   * establish that the paragraph is still there and still says this.
   */
  readonly phrase: string
  /** The predicate. `true` means the tables still say what the claim says. */
  holds(tables: Tables): boolean
}

export const FINDINGS: readonly Finding[] = [
  {
    id: 'session-storage-never-survives',
    half: 'capture',
    claim:
      'No capture wiring keeps `sessionStorage`. The column is constant across four ' +
      'genuinely different recipes, including the one that drives the real sign-in form ' +
      'and therefore had a token in `sessionStorage` when it saved.',
    phrase: 'No wiring keeps `sessionStorage`',
    holds: ({ capture }) => captureColumn('session-storage', capture).every((verdict) => verdict === 'absent'),
  },
  {
    id: 'ui-login-buys-nothing-over-seeding',
    half: 'capture',
    claim:
      'Driving the real sign-in form and hand-seeding `localStorage` after an API login ' +
      'produce identical saved files: `ui-login` and `api-then-seed` agree on all seven ' +
      'cells. The fidelity of the capture is decided by `storageState`, not by how ' +
      'faithfully the session was established.',
    phrase: 'agree on all seven cells',
    holds: ({ capture }) => captureDifferences('ui-login', 'api-then-seed', capture).length === 0,
  },
  {
    id: 'one-option-moves-two-cells',
    half: 'capture',
    claim:
      '`{ indexedDB: true }` is the only difference between `ui-login` and `ui-login-idb`, ' +
      'and it moves exactly two cells — the store and the gate that reads it. Everything ' +
      'else about the two runs is identical.',
    phrase: 'moves exactly two cells',
    holds: ({ capture }) => {
      const moved = captureDifferences('ui-login', 'ui-login-idb', capture)

      return moved.length === 2 && moved.includes('indexed-db') && moved.includes('idb-gate')
    },
  },
  {
    id: 'api-only-is-application-dependent',
    half: 'capture',
    claim:
      'The fastest recipe in the documentation signs in one of the three applications and ' +
      'neither of the other two. Whether `api-only` works is a property of where your ' +
      'application keeps its session, not of the recipe.',
    phrase: 'a property of your application, not of the',
    holds: ({ capture }) =>
      gatesPassed('api-only', capture) === 1 && capture['api-only']?.['server-gate'] === 'signed-in',
  },
  {
    id: 'the-httponly-cookie-is-the-one-thing-kept',
    half: 'capture',
    claim:
      'The `HttpOnly` cookie — the one credential no page script could have read, and ' +
      'therefore the one no hand-written workaround could have saved — is present in every ' +
      'row. It is the only column of the four storage columns that is constant and good.',
    phrase: 'the one thing every wiring keeps',
    holds: ({ capture }) =>
      captureColumn('cookie', capture).every((verdict) => verdict === 'present') &&
      PROBES.filter((probe) => probe.family === 'storage')
        .filter((probe) => probe.key !== 'cookie')
        .some((probe) => captureColumn(probe.key, capture).includes('absent')),
  },
  {
    id: 'eviction-hides-the-collision',
    half: 'isolation',
    claim:
      '`shared-lazy` reads `unreachable` on `parallel-mutation`, and it is the one cell in ' +
      'the table that must not be read as good news: the collision did not happen because ' +
      'it could not happen, because one of the two workers had already been signed out. ' +
      'Scored as `isolated` it would put the worst strategy level with the best ones.',
    phrase: 'must not be read as good news',
    holds: ({ isolation }) =>
      isolation['shared-lazy']?.['parallel-mutation'] === 'unreachable' &&
      isolation['shared-lazy']?.['session-eviction'] === 'evicted',
  },
  {
    id: 'reuse-is-not-isolation',
    half: 'isolation',
    claim:
      'The headline `storageState` recipe fixes eviction and nothing else. `shared-file` ' +
      'clears `session-eviction` and still reads `collided`: reusing one saved session ' +
      'means signing in once, which is a statement about logins, not about accounts.',
    phrase: 'Reuse is not isolation',
    holds: ({ isolation }) =>
      isolation['shared-file']?.['session-eviction'] === 'survives' &&
      isolation['shared-file']?.['parallel-mutation'] === 'collided',
  },
  {
    id: 'one-identifier-one-cell',
    half: 'isolation',
    claim:
      '`per-parallel-index` and `per-worker-index` are one identifier apart and differ in ' +
      'exactly one cell: `restart-inheritance`. The documented recipe keys on ' +
      '`parallelIndex`, which a replacement worker keeps — so it finds the dead worker\'s ' +
      'saved file and resumes its account.',
    phrase: 'One identifier, one cell',
    holds: ({ isolation }) => {
      const moved = isolationDifferences('per-parallel-index', 'per-worker-index', isolation)

      return moved.length === 1 && moved[0] === 'restart-inheritance'
    },
  },
  {
    id: 'the-inheritance-is-visible-in-the-cost-column',
    half: 'isolation',
    claim:
      'The restart shows up as a missing login. `per-parallel-index` signs in three times ' +
      'where `per-worker-index` signs in four, and the login it saves is the replacement ' +
      'worker restoring a file instead of getting an account of its own.',
    phrase: 'The cheaper number is the bug',
    holds: ({ isolation }) =>
      (isolation['per-parallel-index']?.logins ?? 0) + 1 ===
      (isolation['per-worker-index']?.logins ?? 0),
  },
  {
    id: 'per-test-buys-nothing-over-per-worker-index',
    half: 'isolation',
    claim:
      'The most isolated option in the documentation buys nothing over the one-identifier ' +
      'change, on these three hazards. `per-test` and `per-worker-index` clear all three, ' +
      'and `per-test` pays two more sign-ins and one more account for it.',
    phrase: 'The most isolated option in the documentation buys nothing',
    holds: ({ isolation }) =>
      isolationDifferences('per-test', 'per-worker-index', isolation).length === 0 &&
      (isolation['per-test']?.logins ?? 0) > (isolation['per-worker-index']?.logins ?? 0),
  },
  {
    id: 'no-strategy-clears-everything-cheaply',
    half: 'isolation',
    claim:
      'Every strategy that clears all three hazards uses one account per worker or more. ' +
      'There is no row in the table that is both cheap in accounts and clean, which is the ' +
      'trade the two halves of this directory are about.',
    phrase: 'Nothing is both cheap in accounts and clean',
    holds: ({ isolation }) =>
      STRATEGY_KEYS.filter((key) => hazardsCleared(key, isolation) === HAZARDS.length).every(
        (key) => (isolation[key]?.accounts ?? 0) >= 4,
      ),
  },
]

export const FINDING_IDS: readonly string[] = FINDINGS.map((finding) => finding.id)

/** Every finding whose predicate no longer holds against a given pair of tables. */
export function brokenFindings(tables: Tables = MEASURED): string[] {
  return FINDINGS.filter((finding) => !finding.holds(tables)).map((finding) => finding.id)
}

/** Sanity: the vocabulary the findings quote is the vocabulary the tables use. */
export function findingProblems(): string[] {
  const problems: string[] = []

  for (const wiring of WIRING_KEYS) {
    if (EXPECTED_CAPTURE[wiring] === undefined) {
      problems.push(`${wiring} has no capture row, so no finding about it can be checked`)
    }
  }

  for (const hazard of HAZARDS) {
    if (CLEAN_VERDICT[hazard] === undefined) {
      problems.push(`${hazard} has no clean verdict, so "cleared" is undefined for it`)
    }
  }

  return problems
}
