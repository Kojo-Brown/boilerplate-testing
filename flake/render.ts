/**
 * The README's tables and its findings, as data.
 *
 * `README.md` does not restate the matrix in prose: both of its tables are
 * rendered from `matrix.ts` and `identity.ts` by the functions here and
 * compared as text by `readme.test.ts`, the discipline `k6/`, `intercept/`,
 * `trace/` and `lighthouse/` established. There is no version of this
 * directory that agrees with a published table holding a wrong cell.
 *
 * The findings get the same treatment in both directions: each is a predicate
 * over the measured tables plus the heading the README must carry, so a
 * finding that stops being true fails the suite, and a heading with no finding
 * behind it fails it too.
 */

import { EXPECTED_IDENTITY, type TagForm } from './identity.ts'
import { EXPECTED, RETRY_MARKER } from './matrix.ts'
import type { Answers } from './probes.ts'
import { WIRINGS } from './wirings.ts'

/** The versions every cell was measured against. */
export const MEASURED_AGAINST = 'Vitest 3.2.7 and Playwright 1.62.1'

const cell = (value: string | number | undefined): string => (value === undefined ? '—' : String(value))

const row = (cells: readonly (string | number | undefined)[]): string => `| ${cells.map(cell).join(' | ')} |`

const answersOf = (id: string): Answers => {
  const answers = EXPECTED[id]

  if (answers === undefined) throw new Error(`no measured row for wiring ${id}`)

  return answers
}

/** The rerun matrix: eleven wirings, seven probes. */
export function renderMatrix(): string {
  const lines = [
    row(['wiring', 'gate', 'verdict', 'attempts', 'evidence', 'names it', 'counting', 'coverage']),
    `|${Array.from({ length: 8 }, () => '---').join('|')}|`,
  ]

  for (const wiring of WIRINGS) {
    const answers = answersOf(wiring.id)

    lines.push(
      row([
        `\`${wiring.id}\``,
        answers.gate,
        answers.verdict,
        answers.attempts,
        answers.evidence,
        answers.naming,
        answers.counting,
        answers.coverage,
      ]),
    )
  }

  return lines.join('\n')
}

/** What each wiring is, for the table under the matrix. */
export function renderWirings(): string {
  const lines = [row(['wiring', 'retries', 'artifact', 'what it is']), `|${Array.from({ length: 4 }, () => '---').join('|')}|`]

  for (const wiring of WIRINGS) {
    lines.push(
      row([
        `\`${wiring.id}\``,
        wiring.retries,
        `\`${wiring.artifact}\``,
        wiring.rerun === undefined ? wiring.note : `${wiring.note} (${wiring.rerun})`,
      ]),
    )
  }

  return lines.join('\n')
}

/** The identity table: three ways of marking a test, five questions. */
export function renderIdentity(): string {
  const forms: readonly TagForm[] = ['untagged', 'in-title', 'in-option']
  const lines = [
    row(['tagging', 'title', 'tags in report', 'selected by `grep`', 'excluded by `grepInvert`', 'same id as untagged']),
    `|${Array.from({ length: 6 }, () => '---').join('|')}|`,
  ]

  for (const form of forms) {
    const identity = EXPECTED_IDENTITY[form]

    lines.push(
      row([
        `\`${form}\``,
        `\`${identity.title}\``,
        identity.tags.length === 0 ? '—' : `\`${identity.tags.join(', ')}\``,
        identity.selected ? 'yes' : 'no',
        identity.excluded ? 'yes' : 'no',
        identity.idEqualsUntagged ? 'yes' : '**no**',
      ]),
    )
  }

  return lines.join('\n')
}

/** One claim the README makes, and the measurement behind it. */
export interface Finding {
  /** The heading the README must carry, verbatim. */
  readonly heading: string
  /** True when the measured tables still say what the heading says. */
  readonly holds: () => boolean
}

export const FINDINGS: readonly Finding[] = [
  {
    heading: 'Every wiring with retries in it turns the flake green',
    holds: () =>
      WIRINGS.filter((wiring) => wiring.retries > 0).every((wiring) => answersOf(wiring.id).gate === 'green'),
  },
  {
    heading: 'JUnit XML cannot see a flake, in either runner',
    holds: () =>
      WIRINGS.filter((wiring) => wiring.artifact.endsWith('junit')).every((wiring) => {
        const answers = answersOf(wiring.id)

        return answers.verdict === 'passed' && answers.counting === 'blind' && answers.evidence === 'lost'
      }),
  },
  {
    heading: 'Vitest’s JSON report shows the flake only as an inconsistency, and cannot count it',
    holds: () => {
      const answers = answersOf('vitest-json-retry')

      return answers.verdict === 'passed' && answers.evidence === 'kept' && answers.counting === 'unsound'
    },
  },
  {
    heading: 'Playwright records every attempt, and says `flaky` out loud',
    holds: () => {
      const answers = answersOf('playwright-json-retry')

      return answers.verdict === 'flaky' && answers.naming === 'named' && answers.counting === 'sound'
    },
  },
  {
    heading: 'A green Vitest run’s console output names no test at all',
    holds: () => answersOf('vitest-default-retry').coverage === 'nothing',
  },
  {
    heading: 'The verbose reporter, chosen to show retries, is the one that never does',
    holds: () =>
      RETRY_MARKER['vitest-verbose-retry']?.beside === false && RETRY_MARKER['vitest-default-retry']?.beside === true,
  },
  {
    heading: 'A rerun is not a record',
    holds: () =>
      ['vitest-rerun', 'playwright-last-failed'].every((id) => {
        const answers = answersOf(id)

        return answers.gate === 'green' && answers.naming === 'silent'
      }),
  },
  {
    heading: '`--last-failed` writes an artifact with the denominator missing',
    holds: () => answersOf('playwright-last-failed').coverage === 'failures-only',
  },
  {
    heading: 'Putting `@flaky` in a title changes the test’s id; the tag option does not',
    holds: () =>
      EXPECTED_IDENTITY['in-title'].idEqualsUntagged === false &&
      EXPECTED_IDENTITY['in-option'].idEqualsUntagged === true &&
      EXPECTED_IDENTITY['in-option'].selected &&
      EXPECTED_IDENTITY['in-option'].excluded,
  },
]

/** The three wirings a flake rate can be computed from, for the prose. */
export const SOUND_WIRINGS = Object.entries(EXPECTED)
  .filter(([, answers]) => answers.counting === 'sound')
  .map(([id]) => id)
