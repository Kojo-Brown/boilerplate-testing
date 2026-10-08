/**
 * Reading `budgets.json` off disk.
 *
 * Its own module so that `budgets.ts` stays free of `node:fs` — it is imported
 * by the comment renderer and by the wiring audit, and neither should drag a
 * filesystem dependency into the shape census with it.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findBudgetProblems, formatBudgetProblem, type Budget } from './budgets.ts'

/**
 * Path of the budget file this directory publishes.
 *
 * Built with `dirname` + `join` rather than the shorter
 * `new URL('./budgets.json', import.meta.url)`, which cannot be used here:
 * Vite treats that exact expression as its static-asset pattern and rewrites
 * it to a served URL, so `fileURLToPath` then throws "The URL must be of
 * scheme file" — but only when the module is loaded through Vite, which means
 * only under Vitest and not when `node lighthouse/check.ts` runs it. A path
 * helper that works in the gate and throws in the suite is worth the extra
 * import.
 */
export const BUDGETS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'budgets.json')

/**
 * Load and validate the budget file.
 *
 * Validates on load rather than trusting the file. A typo'd metric does not
 * pass silently — LHCI reports an `auditRan` failure for an assertion it cannot
 * read, which was measured rather than assumed — but it fails three minutes
 * into a CI job with a message about an audit nobody wrote, and a duplicated or
 * negative line fails in no way at all. Validating here turns all of those into
 * one legible failure in `pnpm test`. See `wiring.ts` for the cases that *are*
 * silent.
 */
export function loadBudgets(path: string = BUDGETS_PATH): Budget[] {
  const budgets = JSON.parse(readFileSync(path, 'utf8')) as Budget[]

  const problems = findBudgetProblems(budgets)
  if (problems.length > 0) {
    throw new Error(
      [`${path} is not a budget file this repository can enforce:`, ...problems.map((problem) => `  - ${formatBudgetProblem(problem)}`)].join('\n'),
    )
  }

  return budgets
}
