/**
 * Performance budgets: the file, its validation, and what it becomes.
 *
 * ---------------------------------------------------------------------------
 * Why this file is not just `budgets.json`
 * ---------------------------------------------------------------------------
 * A `budgets.json` in the W3C performance-budget shape is the format every
 * guide shows and the one Lighthouse CI still reads, so it stays the artifact
 * a consumer copies. But the file on its own enforces nothing, and the way it
 * is usually wired up enforces nothing either — see {@link ../wiring.ts} for
 * the three wirings and which of them actually fails a build.
 *
 * The short version: Lighthouse 12 removed W3C performance budgets. There is
 * no `budgets` setting and no `performance-budget` / `timing-budget` audit any
 * more. What still works is asserting on audits Lighthouse 12 does have, and
 * Lighthouse CI knows how to turn a budget file into exactly those assertions
 * (`@lhci/utils/src/budgets-converter.js`). This module re-implements that
 * conversion in typed form so that:
 *
 *   - the repository can state what a budget line *becomes* and test it,
 *   - `lighthouserc.cjs` can merge budget assertions with hand-written quality
 *     assertions, which `assert.budgetsFile` cannot do (LHCI throws on
 *     "both budgets AND assertions"), and
 *   - `includePassedAssertions` keeps working, which `assert.budgetsFile` also
 *     breaks — it replaces the whole options object, so the flag is dropped and
 *     the results file can then only ever contain breaches.
 *
 * That last point is what makes a PR comment possible at all: a comment built
 * from a file that lists only failures cannot tell "every budget passed" from
 * "no budget was ever evaluated". Both are an empty array.
 *
 * `budgets.test.ts` asserts this conversion against LHCI's own converter on the
 * real budget file, so drifting from LHCI's semantics — including the KiB
 * factor below — fails `pnpm test` rather than silently changing what the gate
 * means.
 */

/** Resource categories Lighthouse's resource summary reports. */
export const RESOURCE_TYPES = [
  'document',
  'script',
  'stylesheet',
  'image',
  'media',
  'font',
  'other',
  'third-party',
  'total',
] as const

export type ResourceType = (typeof RESOURCE_TYPES)[number]

/**
 * Timing metrics a budget may name.
 *
 * Every one of these must be an audit id Lighthouse 12 still *computes*, which
 * is a stricter requirement than shipping the audit file. The list is
 * deliberately shorter than the one LHCI's vendored validator accepts: LHCI
 * carries a copy of Lighthouse's old budget validation, and that copy still
 * allows `first-meaningful-paint`.
 *
 * Measured: a budget on `first-meaningful-paint` is accepted by LHCI's
 * validator, converted into an assertion, and then fails with `actual: null`.
 * Lighthouse 12 still ships that audit *and* still lists it in the default
 * config — so a test that only checked the audit list would wave it through —
 * but it reports `scoreDisplayMode: "notApplicable"` and no `numericValue` at
 * all. So the cost of a stale metric is a red build whose message is a null:
 * survivable, but not diagnosable. The metric is therefore excluded here, and
 * `check.ts` asserts against a real report that every metric on this list comes
 * back `numeric` while `first-meaningful-paint` comes back `notApplicable` —
 * which is the only place that distinction is visible.
 */
export const TIMING_METRICS = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'speed-index',
  'interactive',
  'total-blocking-time',
  'max-potential-fid',
  'cumulative-layout-shift',
] as const

export type TimingMetric = (typeof TIMING_METRICS)[number]

/** A timing budget line: `budget` is milliseconds (unitless for CLS). */
export interface TimingBudget {
  readonly metric: TimingMetric
  readonly budget: number
}

/** A resource budget line: `budget` is **KiB** for sizes, a count for counts. */
export interface ResourceBudget {
  readonly resourceType: ResourceType
  readonly budget: number
}

/** One budget group, scoped to the paths its `path` glob matches. */
export interface Budget {
  readonly path: string
  readonly timings?: readonly TimingBudget[]
  readonly resourceSizes?: readonly ResourceBudget[]
  readonly resourceCounts?: readonly ResourceBudget[]
}

/**
 * The factor LHCI applies to a `resourceSizes` budget.
 *
 * Budget sizes are **KiB** (1024), not kB (1000). This is the one unit trap in
 * the format: a budget written as `300` against a bundle a reviewer thinks of
 * as "300 kB" is really 307_200 bytes, so a 305_000-byte bundle passes a budget
 * its author believed it broke. `bundlesize/config.ts` in this repository uses
 * decimal kB for the same kind of number, which is exactly how a team ends up
 * with two "300 kB" limits that are 7 KiB apart.
 */
export const KIB = 1024

/** An LHCI assertion: a level and its options, keyed by assertion id. */
export type AssertionLevel = 'off' | 'warn' | 'error'

export interface AssertionOptions {
  readonly maxNumericValue?: number
  readonly minScore?: number
}

export type Assertion = readonly [AssertionLevel, AssertionOptions]

export type Assertions = Readonly<Record<string, Assertion>>

/** A budget line that the validator refuses to vouch for, and why. */
export type BudgetProblem =
  | { kind: 'unknown-metric'; path: string; metric: string }
  | { kind: 'unknown-resource-type'; path: string; group: string; resourceType: string }
  | { kind: 'negative-budget'; path: string; subject: string; budget: number }
  | { kind: 'duplicate'; path: string; subject: string }
  | { kind: 'empty-budget-group'; path: string }

const isTimingMetric = (value: string): value is TimingMetric =>
  (TIMING_METRICS as readonly string[]).includes(value)

const isResourceType = (value: string): value is ResourceType =>
  (RESOURCE_TYPES as readonly string[]).includes(value)

/**
 * Validate a parsed budget file.
 *
 * Returns one problem per offending line; an empty array means every line
 * converts to an assertion against an audit that exists.
 */
export function findBudgetProblems(budgets: readonly Budget[]): BudgetProblem[] {
  const problems: BudgetProblem[] = []

  for (const budget of budgets) {
    const { path } = budget
    const seen = new Set<string>()

    const timings = budget.timings ?? []
    const sizes = budget.resourceSizes ?? []
    const counts = budget.resourceCounts ?? []

    if (timings.length === 0 && sizes.length === 0 && counts.length === 0) {
      problems.push({ kind: 'empty-budget-group', path })
    }

    for (const timing of timings) {
      if (!isTimingMetric(timing.metric)) {
        problems.push({ kind: 'unknown-metric', path, metric: timing.metric })
        continue
      }
      if (timing.budget < 0) {
        problems.push({ kind: 'negative-budget', path, subject: timing.metric, budget: timing.budget })
      }
      if (seen.has(timing.metric)) {
        problems.push({ kind: 'duplicate', path, subject: timing.metric })
      }
      seen.add(timing.metric)
    }

    for (const [group, lines] of [
      ['resourceSizes', sizes],
      ['resourceCounts', counts],
    ] as const) {
      for (const line of lines) {
        const subject = `${group}:${line.resourceType}`
        if (!isResourceType(line.resourceType)) {
          problems.push({ kind: 'unknown-resource-type', path, group, resourceType: line.resourceType })
          continue
        }
        if (line.budget < 0) {
          problems.push({ kind: 'negative-budget', path, subject, budget: line.budget })
        }
        if (seen.has(subject)) {
          problems.push({ kind: 'duplicate', path, subject })
        }
        seen.add(subject)
      }
    }
  }

  return problems
}

/** Render a budget problem as one actionable line for a test failure message. */
export function formatBudgetProblem(problem: BudgetProblem): string {
  switch (problem.kind) {
    case 'unknown-metric':
      return `${problem.path} — "${problem.metric}" is not a timing metric this repository vouches for; add it to TIMING_METRICS only if Lighthouse still ships that audit`
    case 'unknown-resource-type':
      return `${problem.path} — ${problem.group} names resource type "${problem.resourceType}", which Lighthouse's resource summary does not report`
    case 'negative-budget':
      return `${problem.path} — ${problem.subject} has a negative budget (${problem.budget})`
    case 'duplicate':
      return `${problem.path} — ${problem.subject} is budgeted twice; the later line silently wins`
    case 'empty-budget-group':
      return `${problem.path} — budget group has no timings, sizes or counts, so it asserts nothing`
  }
}

/**
 * The LHCI assertion id a budget line becomes.
 *
 * Note the shape: `resource-summary:<type>:count` uses colons, which is how an
 * assertion is *written*. The same assertion comes back in
 * `assertion-results.json` as `auditId: 'resource-summary'` with
 * `auditProperty: '<type>.count'` — dots. `report.ts` joins the two.
 */
export function assertionId(line: BudgetLine): string {
  if (line.kind === 'timing') return line.metric
  return `resource-summary:${line.resourceType}:${line.kind === 'size' ? 'size' : 'count'}`
}

/** One budget line, flattened out of its group and tagged with its kind. */
export type BudgetLine =
  | { readonly kind: 'timing'; readonly path: string; readonly metric: TimingMetric; readonly budget: number }
  | {
      readonly kind: 'size' | 'count'
      readonly path: string
      readonly resourceType: ResourceType
      readonly budget: number
    }

/** Flatten a budget file into one row per line, in file order. */
export function budgetLines(budgets: readonly Budget[]): BudgetLine[] {
  const lines: BudgetLine[] = []

  for (const budget of budgets) {
    for (const timing of budget.timings ?? []) {
      lines.push({ kind: 'timing', path: budget.path, metric: timing.metric, budget: timing.budget })
    }
    for (const count of budget.resourceCounts ?? []) {
      lines.push({ kind: 'count', path: budget.path, resourceType: count.resourceType, budget: count.budget })
    }
    for (const size of budget.resourceSizes ?? []) {
      lines.push({ kind: 'size', path: budget.path, resourceType: size.resourceType, budget: size.budget })
    }
  }

  return lines
}

/** The numeric ceiling a budget line asserts, in the audit's own units. */
export function assertedCeiling(line: BudgetLine): number {
  return line.kind === 'size' ? line.budget * KIB : line.budget
}

/**
 * Convert a budget file into LHCI assertions.
 *
 * Mirrors `convertBudgetsToAssertions` in `@lhci/utils`: timings become a
 * `maxNumericValue` on the metric's own audit, counts and sizes become one on
 * the matching `resource-summary` property, and sizes are multiplied by
 * {@link KIB}. Every line is `error` — a budget that only warns is a number in
 * a file, not a budget.
 *
 * Ordering follows LHCI's: timings, then counts, then sizes. It does not
 * matter to LHCI, and it is kept only so the agreement test can compare the
 * two objects without sorting them first.
 */
export function budgetAssertions(budgets: readonly Budget[]): Assertions {
  const assertions: Record<string, Assertion> = {}

  for (const line of budgetLines(budgets)) {
    assertions[assertionId(line)] = ['error', { maxNumericValue: assertedCeiling(line) }]
  }

  return assertions
}
