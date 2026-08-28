/**
 * The gate: what a scored report has to satisfy, and what it is allowed to
 * contain.
 *
 * Split from `check.ts` so the decision is a pure function of a report and the
 * scope table. That is what lets `policy.test.ts` state the interesting cases
 * — a module that dropped one mutant, a module Stryker produced no mutants
 * for, a file in the report nobody put in the scope — without a mutation run.
 *
 * ---------------------------------------------------------------------------
 * The table is closed in both directions
 * ---------------------------------------------------------------------------
 * A floor for a module that the report never mentions is a floor enforcing
 * nothing, and a file in the report with no floor is a file measured and then
 * ignored. Both are silent. `evaluate` treats each as a violation, so the
 * scope table and the run cannot drift apart in either direction — the same
 * closed-table rule `shape/boundaries.ts` applies to module classifications
 * and `workflow-templates/actionPins.ts` applies to action pins.
 */

import { OVERALL_FLOOR, SCOPE, type ScopeEntry } from './scope.ts'
import type { FileScore, Score, ScoredReport } from './report.ts'

/** Something the gate will not pass, stated so a CI log is enough to act on. */
export type Violation =
  | { readonly kind: 'below-floor'; readonly file: string; readonly detail: string }
  | { readonly kind: 'overall-below-floor'; readonly detail: string }
  | { readonly kind: 'unscoped-file'; readonly file: string; readonly detail: string }
  | { readonly kind: 'unreported-module'; readonly file: string; readonly detail: string }
  | { readonly kind: 'no-mutants'; readonly file: string; readonly detail: string }
  | { readonly kind: 'invalid-mutants'; readonly file: string; readonly detail: string }

const percent = (value: number): string => value.toFixed(2)

/**
 * How many detected mutants a file may lose before its floor binds.
 *
 * This is the number that says whether a floor has teeth or is a screenshot.
 * `README.md` prints it per module, and `readme.test.ts` derives it from the
 * same function rather than trusting the sentence.
 *
 * The epsilon absorbs binary floating point: with 50 valid mutants and a floor
 * of 90, `floor * valid / 100` is 45.000000000000004, and rounding that up
 * would demand 46 kills for a threshold 45 satisfies exactly.
 */
export function headroom(score: Score, floor: number): number {
  if (score.valid === 0) {
    return 0
  }

  const required = Math.ceil((floor * score.valid) / 100 - 1e-9)

  return Math.max(0, score.detected - required)
}

/** The smallest number of detected mutants that satisfies `floor`. */
export function requiredDetected(score: Score, floor: number): number {
  return score.valid === 0 ? 0 : Math.ceil((floor * score.valid) / 100 - 1e-9)
}

/** A scored file paired with the scope entry that governs it. */
export interface GatedFile {
  readonly score: FileScore
  readonly entry: ScopeEntry
  readonly headroom: number
}

export interface Evaluation {
  readonly gated: readonly GatedFile[]
  readonly overall: Score
  readonly overallHeadroom: number
  readonly violations: readonly Violation[]
}

/**
 * Check a scored report against the scope table.
 *
 * `scope` and `overallFloor` are parameters rather than module constants so
 * the tests can state a policy and a report together. A gate whose own tests
 * can only ever assert against the production thresholds is one that has to be
 * edited to be tested, and thresholds edited by tests stop being thresholds.
 */
export function evaluate(
  report: ScoredReport,
  scope: readonly ScopeEntry[] = SCOPE,
  overallFloor: number = OVERALL_FLOOR,
): Evaluation {
  const violations: Violation[] = []
  const gated: GatedFile[] = []
  const byFile = new Map(report.files.map((score) => [score.file, score]))

  for (const entry of scope) {
    const score = byFile.get(entry.module)

    if (score === undefined) {
      violations.push({
        kind: 'unreported-module',
        file: entry.module,
        detail:
          `${entry.module} is in the scope table but the report has no row for it. ` +
          'Either the file moved, or Stryker found nothing to mutate in it.',
      })

      continue
    }

    gated.push({ score, entry, headroom: headroom(score, entry.floor) })

    if (score.compileErrors + score.runtimeErrors > 0) {
      violations.push({
        kind: 'invalid-mutants',
        file: entry.module,
        detail:
          `${score.compileErrors} compile error(s) and ${score.runtimeErrors} runtime error(s). ` +
          'Neither counts toward the score, so the percentage below was computed over a ' +
          'smaller corpus than the run produced.',
      })
    }

    if (score.score === null) {
      violations.push({
        kind: 'no-mutants',
        file: entry.module,
        detail:
          `${entry.module} produced no valid mutants, so it has no score. A module in scope ` +
          'that cannot be mutated is either empty, entirely type declarations, or excluded ' +
          'by a `// Stryker disable` comment — remove it from the scope rather than ' +
          'carrying a floor nothing is measured against.',
      })

      continue
    }

    if (score.score < entry.floor) {
      violations.push({
        kind: 'below-floor',
        file: entry.module,
        detail:
          `${entry.module} scored ${percent(score.score)}%, below its floor of ${entry.floor}%. ` +
          `${score.detected} of ${score.valid} mutants were detected; ` +
          `${requiredDetected(score, entry.floor)} are needed.`,
      })
    }
  }

  const scoped = new Set(scope.map((entry) => entry.module))

  for (const score of report.files) {
    if (!scoped.has(score.file)) {
      violations.push({
        kind: 'unscoped-file',
        file: score.file,
        detail:
          `${score.file} was mutated but is not in the scope table, so nothing gates it. ` +
          'Add it to `mutation/scope.ts` with a floor, or take it out of the run.',
      })
    }
  }

  const overall = report.total

  if (overall.score !== null && overall.score < overallFloor) {
    violations.push({
      kind: 'overall-below-floor',
      detail:
        `the run scored ${percent(overall.score)}%, below the overall floor of ${overallFloor}%. ` +
        `${overall.detected} of ${overall.valid} mutants were detected; ` +
        `${requiredDetected(overall, overallFloor)} are needed.`,
    })
  }

  return {
    gated,
    overall,
    overallHeadroom: headroom(overall, overallFloor),
    violations,
  }
}
