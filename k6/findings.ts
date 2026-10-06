/**
 * What this directory claims, and the predicate behind each claim.
 *
 * README.md is rendered from this file rather than written alongside it. The
 * discipline `intercept/`, `trace/` and `authstate/` established: a published
 * table holding a wrong cell, or a finding that has quietly stopped being
 * true, must fail a test rather than survive because nobody re-read the prose.
 *
 * Every `holds()` below is cheap and in-memory. The expensive half — whether
 * the real k6 binary still behaves this way — is `check.ts`, and the two are
 * deliberately separate: this fails in milliseconds on a laptop, that fails in
 * seconds in a job that has k6 installed.
 */

import { AGREEMENT_CASES } from './agreement.ts'
import {
  peakVUs,
  profileDuration,
  profiles,
  spikeProfile,
  steepestRamp,
  stressProfile,
  type LoadProfile,
  type ProfileName,
} from './config.ts'
import {
  BREACHED,
  k6Passed,
  parseMetricKey,
  parseThreshold,
  passesVacuously,
  readAggregate,
} from './thresholds.ts'

/** The k6 version every measurement in README.md was taken against. */
export const MEASURED_AGAINST = 'k6 v1.3.0'

/** What each scenario is for, in one line, as the README publishes it. */
export const QUESTIONS: Readonly<Record<ProfileName, string>> = {
  smoke: 'Does it work at all?',
  load: 'Does it meet its targets at expected traffic?',
  stress: 'Where does it break, and how?',
  soak: 'Does it still work after four hours?',
  spike: 'Does it come back?',
}

function humanDuration(seconds: number): string {
  if (seconds >= 3600) {
    const hours = seconds / 3600
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
  }
  if (seconds >= 60) {
    const minutes = seconds / 60
    return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}m`
  }
  return `${seconds}s`
}

function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const all = [header, ...rows]
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? '').length)),
  )

  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`

  return [
    line(header),
    `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`,
    ...rows.map(line),
  ].join('\n')
}

/** The five scenarios, measured rather than described. */
export function renderProfileTable(): string {
  const rows = (Object.entries(profiles) as [ProfileName, LoadProfile][]).map(
    ([name, profile]) => [
      `\`${name}\``,
      String(peakVUs(profile)),
      humanDuration(profileDuration(profile)),
      `${steepestRamp(profile).toFixed(1)} VU/s`,
      String(Object.values(profile.thresholds).reduce((acc, list) => acc + list.length, 0)),
      QUESTIONS[name],
    ],
  )

  return renderTable(['scenario', 'peak VUs', 'duration', 'steepest ramp', 'thresholds', 'answers'], rows)
}

/** The threshold shapes, and whether each one has teeth on an empty sub-metric. */
export function renderWitnessTable(): string {
  const rows = ['p(95)<500', 'avg<300', 'max<1000', 'rate<0.01', 'count>0', 'count>=1'].map(
    (expression) => {
      const vacuous = passesVacuously(parseThreshold(expression))

      return [
        `\`${expression}\``,
        vacuous ? 'passes' : 'breaches',
        vacuous ? 'no — enforces nothing' : 'yes — usable as a witness',
      ]
    },
  )

  return renderTable(['threshold', 'on an empty sub-metric', 'has teeth?'], rows)
}

export interface Finding {
  /** The README heading this finding is published under, matched as a whole line. */
  readonly heading: string
  readonly holds: () => boolean
}

/**
 * Fixtures in the shape a real export was observed to carry, so the predicates
 * below are about the semantics rather than about this file's own literals.
 */
const COUNTER_EXPORT = { count: 9428, rate: 4713.5 }
const RATE_EXPORT = { passes: 9428, fails: 9428, value: 0.5 }

export const FINDINGS: readonly Finding[] = [
  {
    heading: '### The summary boolean means "breached", not "passed"',
    holds: () =>
      BREACHED === true &&
      k6Passed({ thresholds: { 'p(95)<200': false } }, 'p(95)<200') === true &&
      k6Passed({ thresholds: { 'p(95)<200': true } }, 'p(95)<200') === false,
  },
  {
    heading: '### `rate` means one thing on a Counter and another on a Rate',
    holds: () => {
      const counter = readAggregate(COUNTER_EXPORT, 'rate')
      const rate = readAggregate(RATE_EXPORT, 'rate')

      if (!counter.found || !rate.found) return false

      // Same word, two keys, and four orders of magnitude between the answers.
      return counter.key === 'rate' && rate.key === 'value' && rate.value === 0.5
    },
  },
  {
    heading: '### A threshold k6 evaluated can be missing from the export',
    holds: () => AGREEMENT_CASES.filter((testCase) => !testCase.inDefaultExport).length === 1,
  },
  {
    heading: '### A misspelt sub-metric selector passes',
    holds: () =>
      passesVacuously(parseThreshold('p(95)<500')) &&
      passesVacuously(parseThreshold('rate<0.01')) &&
      !passesVacuously(parseThreshold('count>0')),
  },
  {
    heading: '### The spike profile is the one that needs a witness',
    holds: () => {
      const selectors = new Set(
        Object.keys(spikeProfile.thresholds)
          .map((key) => parseMetricKey(key).selector)
          .filter((selector): selector is string => selector !== undefined),
      )

      if (selectors.size === 0) return false

      return [...selectors].every((selector) =>
        Object.entries(spikeProfile.thresholds).some(
          ([key, expressions]) =>
            parseMetricKey(key).selector === selector &&
            expressions.some((expression) => !passesVacuously(parseThreshold(expression))),
        ),
      )
    },
  },
  {
    heading: '### Spike and stress differ by slope, not by peak alone',
    holds: () => steepestRamp(spikeProfile) > steepestRamp(stressProfile) * 50,
  },
]
