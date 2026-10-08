/**
 * Reading `.lighthouseci/assertion-results.json` back into budget rows.
 *
 * ---------------------------------------------------------------------------
 * Why this is a join and not a map
 * ---------------------------------------------------------------------------
 * The obvious implementation of a budget PR comment is "read the assertion
 * results, render them". It is wrong in a way that only shows up on the happy
 * path: under LHCI's defaults the results file contains **failures only**, so
 * a run where every budget was met and a run where no budget was ever evaluated
 * both produce `[]`. Render that directly and the comment says "✅ all budgets
 * met" for a config whose budgets are wired the dead way (see wiring.ts) — the
 * comment becomes the most convincing possible evidence for the thing that is
 * not happening.
 *
 * `includePassedAssertions: true` fixes most of it: the passing rows appear, so
 * `[]` now means "nothing was evaluated" rather than "nothing failed". It does
 * not make the file self-describing, because it still says nothing about a
 * budget line that produced no row at all.
 *
 * What produces no row was measured rather than guessed, and it is a shorter
 * list than it first looks:
 *
 *   - **No LHR at all.** Results are grouped by URL, so a collect that produced
 *     nothing produces no rows — and the comment would otherwise report a
 *     perfect score for a run that never loaded the page.
 *   - **An assertion id LHCI special-cases**, which in practice means
 *     `performance-budget`; see wiring.ts.
 *
 * A budget line against a real audit always produces a row. A `resourceType`
 * absent from the page does *not* go unmeasured: Lighthouse's resource summary
 * reports every type, so an unused one comes back `actual: 0` and passes, which
 * is correct. An audit Lighthouse has stopped computing comes back `actual:
 * null` and fails, and an id Lighthouse never had fails as `auditRan`.
 *
 * So the rows are joined against the budget file rather than read off it:
 * {@link joinBudgetResults} walks every line the budget declares and looks for
 * its result. A line with no result is {@link BudgetRowStatus} `'not-measured'`,
 * which the comment renders as a warning and the gate treats as a failure.
 * That is the conservative direction, and it is the only one that survives the
 * first case above: a budget nobody measured is not a budget that passed.
 */

import {
  assertedCeiling,
  assertionId,
  budgetLines,
  KIB,
  type Budget,
  type BudgetLine,
} from './budgets.ts'

/** One row of LHCI's `assertion-results.json`. */
export interface AssertionResult {
  readonly name: string
  readonly expected: number
  readonly actual: number
  readonly operator: string
  readonly passed: boolean
  readonly auditId: string
  /** Present for the compound ids: `resource-summary`, `categories`. */
  readonly auditProperty?: string
  readonly level: 'warn' | 'error'
  readonly url: string
  readonly auditTitle?: string
  readonly auditDocumentationLink?: string
}

export type BudgetRowStatus = 'passed' | 'breached' | 'not-measured'

/** A budget line joined to what the run measured for it. */
export interface BudgetRow {
  readonly line: BudgetLine
  /** The LHCI assertion id, colon-separated. */
  readonly id: string
  readonly status: BudgetRowStatus
  /** The budget, in the audit's own units (bytes for sizes). */
  readonly ceiling: number
  /** What the run measured, or `null` when nothing measured it. */
  readonly actual: number | null
  /** The URL the row was measured on, or `null` when not measured. */
  readonly url: string | null
  readonly auditTitle: string | null
  readonly documentationLink: string | null
}

/**
 * The assertion id a result row belongs to.
 *
 * Results name a compound assertion in two parts — `auditId: 'resource-summary'`
 * with `auditProperty: 'script.count'` — while an assertion is *written*
 * `resource-summary:script:count`. The separator differs, which is the one
 * thing a naive `${auditId}:${auditProperty}` gets wrong.
 */
export function resultAssertionId(result: AssertionResult): string {
  if (result.auditProperty === undefined) return result.auditId
  return [result.auditId, ...result.auditProperty.split('.')].join(':')
}

/**
 * Join a budget file against a run's assertion results.
 *
 * Results for assertions that are not budget lines (category scores, the
 * accessibility audits) are ignored here; `nonBudgetFailures` reports those.
 * Rows come back in budget-file order so the comment is stable across runs and
 * a diff between two comments is readable.
 */
export function joinBudgetResults(
  budgets: readonly Budget[],
  results: readonly AssertionResult[],
): BudgetRow[] {
  const byId = new Map<string, AssertionResult>()
  for (const result of results) {
    const id = resultAssertionId(result)
    // Several URLs can produce a row for one assertion. Keep the worst, so a
    // page that breaches is never hidden behind a sibling that did not.
    const existing = byId.get(id)
    if (existing === undefined || (existing.passed && !result.passed)) byId.set(id, result)
  }

  return budgetLines(budgets).map((line) => {
    const id = assertionId(line)
    const result = byId.get(id)
    const ceiling = assertedCeiling(line)

    if (result === undefined) {
      return {
        line,
        id,
        status: 'not-measured' as const,
        ceiling,
        actual: null,
        url: null,
        auditTitle: null,
        documentationLink: null,
      }
    }

    return {
      line,
      id,
      status: result.passed ? ('passed' as const) : ('breached' as const),
      ceiling,
      actual: result.actual,
      url: result.url,
      auditTitle: result.auditTitle ?? null,
      documentationLink: result.auditDocumentationLink ?? null,
    }
  })
}

/**
 * Failing assertions that are not budget lines.
 *
 * The published config asserts category scores and a handful of accessibility
 * audits alongside the budgets. They are not budgets, so they do not belong in
 * the budget table, but a comment that silently dropped them would be reporting
 * a green budget table on a red run — which is the same failure as the one at
 * the top of this file, arrived at from the other side.
 */
export function nonBudgetFailures(
  budgets: readonly Budget[],
  results: readonly AssertionResult[],
): AssertionResult[] {
  const budgetIds = new Set(budgetLines(budgets).map(assertionId))
  return results.filter((result) => !result.passed && !budgetIds.has(resultAssertionId(result)))
}

/** A whole run, reduced to what the comment and the gate both need. */
export interface BudgetReport {
  readonly rows: readonly BudgetRow[]
  readonly otherFailures: readonly AssertionResult[]
  readonly breached: number
  readonly notMeasured: number
  readonly passed: number
  /** False when anything breached, went unmeasured, or failed outside budgets. */
  readonly ok: boolean
}

export function buildBudgetReport(
  budgets: readonly Budget[],
  results: readonly AssertionResult[],
): BudgetReport {
  const rows = joinBudgetResults(budgets, results)
  const otherFailures = nonBudgetFailures(budgets, results)

  const breached = rows.filter((row) => row.status === 'breached').length
  const notMeasured = rows.filter((row) => row.status === 'not-measured').length
  const passed = rows.filter((row) => row.status === 'passed').length

  return {
    rows,
    otherFailures,
    breached,
    notMeasured,
    passed,
    ok: breached === 0 && notMeasured === 0 && otherFailures.length === 0,
  }
}

/** Parse the results file's text. Throws with the path on malformed JSON. */
export function parseAssertionResults(text: string, source: string): AssertionResult[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${source} is not valid JSON`, { cause: error })
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${source} should hold an array of assertion results, found ${typeof parsed}`)
  }

  return parsed as AssertionResult[]
}

/** A byte count as KiB, matching the unit a size budget is written in. */
export function asKib(bytes: number): string {
  return `${(bytes / KIB).toFixed(1)} KiB`
}

/**
 * Format a measured value in the units its budget line is written in.
 *
 * Discriminated on `kind === 'timing'` positively rather than by eliminating
 * the other two: the resource variant carries `kind: 'size' | 'count'`, so
 * narrowing it away one literal at a time does not reduce the union to the
 * timing member and `line.metric` does not typecheck.
 */
export function formatValue(line: BudgetLine, value: number): string {
  if (line.kind === 'timing') {
    // CLS is unitless and lives in the low hundredths; rounded to milliseconds
    // every value it can take would print as `0 ms`.
    if (line.metric === 'cumulative-layout-shift') return value.toFixed(3)
    return `${Math.round(value)} ms`
  }

  return line.kind === 'size' ? asKib(value) : String(Math.round(value))
}

/** Format a budget line's ceiling in the same units as {@link formatValue}. */
export function formatCeiling(line: BudgetLine): string {
  return formatValue(line, assertedCeiling(line))
}

/** The human label for a budget line. */
export function lineLabel(line: BudgetLine): string {
  if (line.kind === 'timing') return line.metric
  return `${line.resourceType} ${line.kind}`
}
