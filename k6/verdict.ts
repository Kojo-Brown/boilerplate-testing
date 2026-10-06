/**
 * A k6 summary export, turned into a pass/fail verdict.
 *
 * Why recompute a verdict k6 already reached: because the exit code is one bit
 * for the whole run. "Exit 99" says a threshold broke, not which, not by how
 * much, and not whether the one that broke was the one that matters — on the
 * spike profile, `http_req_duration` breaching during the burst is the test
 * working and `http_req_duration{phase:recovery}` breaching is the system
 * failing, and 99 is both. So the export is read per threshold.
 *
 * Recomputing also makes the three k6 semantics in `thresholds.ts` testable
 * instead of commented: every threshold is scored twice, once from k6's own
 * boolean and once from the metric values, and a disagreement between those
 * two is itself a finding. `check.ts` runs that comparison against the real
 * binary. See README.md.
 */

import {
  evaluateThreshold,
  k6Passed,
  parseThreshold,
  type ParsedThreshold,
  type SummaryMetric,
  type ThresholdOutcome,
} from './thresholds.ts'

/** The shape `k6 run --summary-export` writes. */
export interface SummaryExport {
  readonly metrics: Readonly<Record<string, SummaryMetric>>
}

/**
 * Parses and validates a summary export.
 *
 * A summary with no `metrics` object is rejected rather than treated as a run
 * with no thresholds: the difference between "nothing breached" and "the file
 * is not a summary" is the difference between a green gate and no gate.
 */
export function parseSummary(raw: string): SummaryExport {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`Summary export is not valid JSON: ${(cause as Error).message}`, { cause })
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Summary export is not an object: got ${typeof parsed}`)
  }

  const metrics = (parsed as Record<string, unknown>)['metrics']

  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
    throw new Error('Summary export has no `metrics` object — is this a k6 --summary-export file?')
  }

  return { metrics: metrics as Readonly<Record<string, SummaryMetric>> }
}

/**
 * How k6's verdict and the recomputed one relate.
 *
 * `absent` and `unverifiable` are deliberately not folded into `disagree`:
 * they are states of the *export*, not of the system under test, and a report
 * that calls them disagreements sends the reader looking for a bug in k6.
 */
export type Agreement =
  /** Both scored it, and they match. */
  | 'agree'
  /** Both scored it, and they do not. One of the two is wrong. */
  | 'disagree'
  /** k6 scored it; the export carries no number to recompute from. */
  | 'unverifiable'
  /** k6 did not score it: the metric or the threshold is missing from the export. */
  | 'absent'

export interface ThresholdReport {
  /** The metric key as declared, including any sub-metric selector. */
  readonly metric: string
  readonly parsed: ParsedThreshold
  /** k6's verdict: `true` passed, `false` breached, `undefined` not scored. */
  readonly k6: boolean | undefined
  readonly recomputed: ThresholdOutcome
  readonly agreement: Agreement
}

function agreementOf(
  k6: boolean | undefined,
  recomputed: ThresholdOutcome,
): Agreement {
  if (k6 === undefined) return 'absent'
  if (!recomputed.verifiable) return 'unverifiable'
  return recomputed.passed === k6 ? 'agree' : 'disagree'
}

/**
 * Scores every declared threshold against a summary export.
 *
 * `declared` is a profile's `thresholds` map, so the report covers what the
 * run was *asked* to enforce. Reading the export's own threshold keys instead
 * would miss the failure this catches: a threshold that was declared, never
 * evaluated because its sub-metric tag was never set, and therefore cannot
 * breach. That one reports as `absent`, not as a pass.
 */
export function reportThresholds(
  summary: SummaryExport,
  declared: Readonly<Record<string, readonly string[]>>,
): ThresholdReport[] {
  const reports: ThresholdReport[] = []

  for (const [metric, expressions] of Object.entries(declared)) {
    const exported = summary.metrics[metric] ?? {}

    for (const expression of expressions) {
      const parsed = parseThreshold(expression)
      const k6 = k6Passed(exported, parsed.expression)
      const recomputed = evaluateThreshold(parsed, exported)

      reports.push({ metric, parsed, k6, recomputed, agreement: agreementOf(k6, recomputed) })
    }
  }

  return reports
}

export interface Verdict {
  /** False when any threshold breached, or when any could not be scored at all. */
  readonly passed: boolean
  readonly breached: readonly ThresholdReport[]
  readonly absent: readonly ThresholdReport[]
  readonly unverifiable: readonly ThresholdReport[]
  readonly disagreed: readonly ThresholdReport[]
}

/**
 * The run-level verdict.
 *
 * `absent` fails the run. A threshold nobody evaluated is not a threshold that
 * held — and the common cause, a sub-metric selector whose tag the scenario
 * never sets, is a typo that would otherwise turn the spike profile's recovery
 * gate off while leaving it in the file.
 *
 * `unverifiable` does not fail the run on its own: k6 did score it, and k6's
 * score is the contract. It is surfaced so the reader knows which lines of the
 * report are k6's word alone.
 */
export function verdict(reports: readonly ThresholdReport[]): Verdict {
  const breached = reports.filter((r) => r.k6 === false)
  const absent = reports.filter((r) => r.agreement === 'absent')

  return {
    passed: breached.length === 0 && absent.length === 0,
    breached,
    absent,
    unverifiable: reports.filter((r) => r.agreement === 'unverifiable'),
    disagreed: reports.filter((r) => r.agreement === 'disagree'),
  }
}

const SYMBOLS: Readonly<Record<Agreement, string>> = {
  agree: '✓',
  disagree: '✗',
  unverifiable: '?',
  absent: '!',
}

/**
 * The report as a table, for a CI log.
 *
 * Written for someone who has just been told the load gate is red: every row
 * carries the observed number and which export key it came from, so the
 * decision is visible without re-running anything.
 */
export function renderReport(reports: readonly ThresholdReport[]): string {
  const rows = reports.map((report) => {
    const observed = report.recomputed.verifiable
      ? `${report.recomputed.observed.toPrecision(6)} (${report.recomputed.key})`
      : `— (no ${report.recomputed.tried.join('/')} in export)`

    const k6 = report.k6 === undefined ? 'not scored' : report.k6 ? 'pass' : 'BREACH'

    return [
      SYMBOLS[report.agreement],
      `${report.metric}: ${report.parsed.expression}`,
      k6,
      observed,
      report.agreement,
    ]
  })

  const header = ['', 'threshold', 'k6', 'recomputed', 'agreement']
  const all = [header, ...rows]
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? '').length)),
  )

  return all
    .map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd())
    .join('\n')
}
