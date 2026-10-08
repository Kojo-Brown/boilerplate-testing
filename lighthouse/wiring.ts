/**
 * The three ways to wire a budget file into Lighthouse CI, and which one gates.
 *
 * ---------------------------------------------------------------------------
 * The measurement
 * ---------------------------------------------------------------------------
 * One `budgets.json`, one page that breaches every line in it by more than an
 * order of magnitude, three wirings. `check.ts` runs all three against a real
 * Chromium every time the gate runs, so the table below is re-derived rather
 * than quoted:
 *
 *   | wiring                                   | failures | exit |
 *   |------------------------------------------|----------|------|
 *   | `collect.settings.budgets`               |        0 |    0 |
 *   | `assert.assertions['performance-budget']`|        0 |    0 |
 *   | `assert.budgetsFile`                     |        6 |    1 |
 *   | `assert.assertions` ← derived            |        6 |    1 |
 *
 * The first two are the two wirings a reader is most likely to already have,
 * and both report green while every budget is blown.
 *
 * `collect.settings.budgets` is dead because **Lighthouse 12 removed W3C
 * performance budgets**. `budgets` is not in `defaultSettings`, not in the
 * settings type, and `core/audits/` contains no `performance-budget.js` or
 * `timing-budget.js` at all. Lighthouse does not reject the unknown setting;
 * it ignores it. So the budget file is parsed, handed over, and dropped.
 *
 * `assert.assertions['performance-budget']` is dead one layer up, and this is
 * the worst of the three because it is the wiring that *looks* like explicit
 * enforcement. LHCI special-cases that id: `getBudgetAssertionResults` reads
 * the `performance-budget` audit out of each LHR and walks `details.items`
 * looking for `sizeOverBudget` / `countOverBudget`. Against a Lighthouse 12 LHR
 * the audit is `undefined`, the loop `continue`s, and the function returns `[]`
 * — **zero assertion results, which is indistinguishable from zero failures**.
 *
 * The sibling audit makes the point sharper. `assert.assertions['timing-budget']`
 * has no handler in LHCI, so it falls through to the standard path, fails to
 * read the audit, and reports an `auditRan` failure: exit 1, measured. The
 * special case written to support budgets is the only reason the budget one is
 * silent.
 *
 * `assert.budgetsFile` works, because it does not depend on the removed audits:
 * LHCI converts the file into assertions on audits Lighthouse 12 still has
 * (`resource-summary` and the timing audits). It has two costs, and they are
 * why this directory does not use it — see {@link ../budgets.ts}: it cannot be
 * combined with `assert.assertions` (LHCI throws "Cannot use both budgets AND
 * assertions"), and it replaces the whole options object, dropping
 * `includePassedAssertions` so the results file can only ever hold breaches.
 *
 * So the published wiring is the fourth row: the same conversion, done by
 * `budgets.ts`, merged with the hand-written quality assertions.
 *
 * ---------------------------------------------------------------------------
 * Why this is a module and not a paragraph in the README
 * ---------------------------------------------------------------------------
 * Both dead wirings fail *towards green*, and neither leaves a trace in a CI
 * log — there is no warning, no "unknown setting", no skipped-audit line. A
 * reader who reverts `lighthouserc.cjs` to the shape every Lighthouse CI guide
 * shows gets a passing build with no budget enforcement and nothing to notice.
 * {@link findWiringProblems} is therefore a unit test over the real config
 * file: wiring the budgets the dead way fails `pnpm test` in milliseconds
 * instead of passing CI forever.
 */

import { budgetAssertions, type Assertions, type Budget } from './budgets.ts'

/**
 * The id LHCI special-cases, and the only assertion id that can pass vacuously.
 *
 * Measured, because the two removed audits behave in *opposite* ways and the
 * difference is the whole finding:
 *
 *   | assertion            | rows | exit | why                                 |
 *   |----------------------|------|------|-------------------------------------|
 *   | `performance-budget` |    0 |    0 | LHCI special-cases it and returns []|
 *   | `timing-budget`      |    1 |    1 | no special case → `auditRan` failure|
 *
 * `timing-budget` fails *loudly* — LHCI has no handler for it, so it falls
 * through to the standard path, cannot read the audit, and reports an
 * `auditRan` failure. `performance-budget` passes *silently* precisely because
 * LHCI does have a handler for it: the code written to support budgets is what
 * swallows them.
 */
export const DEAD_BUDGET_ASSERTION = 'performance-budget'

/** The other removed audit. Loud rather than silent, but still never correct. */
export const DEAD_TIMING_ASSERTION = 'timing-budget'

/**
 * Audit ids Lighthouse 12 no longer ships, so no assertion on them is correct.
 *
 * Both are reported by {@link findWiringProblems}, though only
 * {@link DEAD_BUDGET_ASSERTION} is dangerous: the other merely breaks the build
 * in a confusing way rather than passing it in a confident one.
 */
export const REMOVED_BUDGET_AUDITS: readonly string[] = [
  DEAD_BUDGET_ASSERTION,
  DEAD_TIMING_ASSERTION,
]

/** The shape of a `lighthouserc` object, to the depth this audit reads. */
export interface LighthouseRc {
  readonly ci?: {
    readonly collect?: {
      readonly settings?: Readonly<Record<string, unknown>>
      readonly url?: readonly string[]
      readonly numberOfRuns?: number
    }
    readonly assert?: {
      readonly assertions?: Readonly<Record<string, unknown>>
      readonly budgetsFile?: string
      readonly includePassedAssertions?: boolean
      readonly preset?: string
    }
  }
}

/** A way the config fails to enforce the budgets it appears to declare. */
export type WiringProblem =
  | { kind: 'budgets-in-collect-settings' }
  | { kind: 'removed-audit-assertion'; auditId: string }
  | { kind: 'budget-line-unasserted'; assertionId: string }
  | { kind: 'budget-line-wrong-ceiling'; assertionId: string; expected: number; found: unknown }
  | { kind: 'budget-line-not-error'; assertionId: string; level: unknown }
  | { kind: 'passed-assertions-excluded' }
  | { kind: 'no-assertions-at-all' }

/**
 * Audit a `lighthouserc` against the budget file it is supposed to enforce.
 *
 * Checks the two dead wirings, then checks the live one positively: every line
 * in `budgets` must appear in `assert.assertions` at `error` with the ceiling
 * {@link budgetAssertions} derives for it. A missing line is the failure mode
 * that matters most — it is how a budget quietly stops being enforced while the
 * file that declares it still looks complete.
 */
export function findWiringProblems(
  rc: LighthouseRc,
  budgets: readonly Budget[],
): WiringProblem[] {
  const problems: WiringProblem[] = []
  const assertBlock = rc.ci?.assert
  const assertions = assertBlock?.assertions

  if (rc.ci?.collect?.settings !== undefined && 'budgets' in rc.ci.collect.settings) {
    problems.push({ kind: 'budgets-in-collect-settings' })
  }

  for (const auditId of REMOVED_BUDGET_AUDITS) {
    if (assertions !== undefined && auditId in assertions) {
      problems.push({ kind: 'removed-audit-assertion', auditId })
    }
  }

  if (assertions === undefined) {
    // `budgetsFile` is a working wiring, so it is not reported as a dead one;
    // it simply cannot be audited line-by-line from here, and it is not what
    // this repository publishes. Anything else asserts nothing.
    if (assertBlock?.budgetsFile === undefined) problems.push({ kind: 'no-assertions-at-all' })
    return problems
  }

  // A PR comment needs the passing rows too, or it cannot tell "all budgets
  // met" from "no budget was evaluated". See report.ts.
  if (assertBlock?.includePassedAssertions !== true) {
    problems.push({ kind: 'passed-assertions-excluded' })
  }

  const expected = budgetAssertions(budgets)

  for (const [id, [level, options]] of Object.entries(expected) as [
    string,
    [string, { maxNumericValue?: number }],
  ][]) {
    const found = assertions[id]
    if (found === undefined) {
      problems.push({ kind: 'budget-line-unasserted', assertionId: id })
      continue
    }

    if (!Array.isArray(found)) {
      problems.push({ kind: 'budget-line-not-error', assertionId: id, level: found })
      continue
    }

    const [foundLevel, foundOptions] = found as [unknown, unknown]
    if (foundLevel !== level) {
      problems.push({ kind: 'budget-line-not-error', assertionId: id, level: foundLevel })
    }

    const ceiling =
      typeof foundOptions === 'object' && foundOptions !== null
        ? (foundOptions as { maxNumericValue?: unknown }).maxNumericValue
        : undefined

    if (ceiling !== options.maxNumericValue) {
      problems.push({
        kind: 'budget-line-wrong-ceiling',
        assertionId: id,
        expected: options.maxNumericValue ?? Number.NaN,
        found: ceiling,
      })
    }
  }

  return problems
}

/** Render a wiring problem as one actionable line for a test failure message. */
export function formatWiringProblem(problem: WiringProblem): string {
  switch (problem.kind) {
    case 'budgets-in-collect-settings':
      return 'ci.collect.settings.budgets is set, and Lighthouse 12 ignores it — there is no `budgets` setting and no performance-budget audit. Derive assertions from budgets.json instead; see wiring.ts'
    case 'removed-audit-assertion':
      return `ci.assert.assertions["${problem.auditId}"] asserts on an audit Lighthouse 12 does not ship, so it yields zero assertion results and always passes`
    case 'budget-line-unasserted':
      return `budgets.json declares ${problem.assertionId}, but no assertion enforces it`
    case 'budget-line-wrong-ceiling':
      return `${problem.assertionId} should assert maxNumericValue ${problem.expected} (remember sizes are KiB), found ${String(problem.found)}`
    case 'budget-line-not-error':
      return `${problem.assertionId} must assert at "error"; found ${JSON.stringify(problem.level)}`
    case 'passed-assertions-excluded':
      return 'ci.assert.includePassedAssertions must be true, or assertion-results.json holds only breaches and the PR comment cannot distinguish "all budgets met" from "nothing ran"'
    case 'no-assertions-at-all':
      return 'ci.assert declares neither assertions nor budgetsFile, so the run asserts nothing'
  }
}

/**
 * The wirings as data, for the README table and for `check.ts` to run.
 *
 * `gates` is the claim each row makes: whether a page that breaches every
 * budget line makes `lhci autorun` exit non-zero. `check.ts` measures it.
 */
export interface WiringCase {
  readonly id: string
  /** How the budgets reach LHCI, in the config's own vocabulary. */
  readonly label: string
  /** Does a page over every budget fail the run? */
  readonly gates: boolean
  /** Why, in one line. */
  readonly because: string
}

export const WIRING_CASES: readonly WiringCase[] = [
  {
    id: 'collect-settings',
    label: 'ci.collect.settings.budgets',
    gates: false,
    because:
      'Lighthouse 12 has no `budgets` setting and no budget audits; the setting is ignored without a warning',
  },
  {
    id: 'performance-budget-assertion',
    label: "ci.assert.assertions['performance-budget']",
    gates: false,
    because:
      'LHCI reads the removed performance-budget audit, finds nothing, and returns zero assertion results',
  },
  {
    id: 'budgets-file',
    label: 'ci.assert.budgetsFile',
    gates: true,
    because:
      'LHCI converts the file into resource-summary and timing assertions, which Lighthouse 12 still computes',
  },
  {
    id: 'derived-assertions',
    label: 'ci.assert.assertions ← budgetAssertions()',
    gates: true,
    because:
      'the same conversion, done here, so it can be merged with quality assertions and keep includePassedAssertions',
  },
]

/** The wiring this repository publishes. */
export const PUBLISHED_WIRING = 'derived-assertions'

/**
 * Merge budget assertions with hand-written ones.
 *
 * Budgets win: a quality assertion that happens to name the same audit as a
 * budget line would otherwise silently replace the budget, which is the drift
 * `findWiringProblems` exists to catch. Doing it in this order means the config
 * cannot express that mistake in the first place.
 */
export function mergeAssertions(
  quality: Assertions,
  budgets: readonly Budget[],
): Assertions {
  return { ...quality, ...budgetAssertions(budgets) }
}
