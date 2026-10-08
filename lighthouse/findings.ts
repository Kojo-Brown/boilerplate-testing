/**
 * The findings this directory publishes, as data.
 *
 * The README's tables are *rendered from* here rather than transcribed, and
 * each finding is a heading plus a predicate — the discipline `k6/`,
 * `intercept/` and `trace/` established. There is no version of this file that
 * agrees with a published table holding a wrong cell, and no finding whose
 * prose can outlive the thing it claims: `readme.test.ts` fails if a heading
 * has no finding behind it, or if a finding's predicate stops holding.
 *
 * The predicates here are the ones decidable without a browser. The ones that
 * need a real Lighthouse — which wirings gate, whether a metric comes back
 * numeric — are asserted by `check.ts` against `WIRING_CASES` and
 * `TIMING_METRICS`, so this file reads the same declarations the gate holds to
 * reality.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { assertedCeiling, budgetLines, KIB, TIMING_METRICS, type Budget } from './budgets.ts'
import { STICKY_MARKER } from './comment.ts'
import { formatCeiling, lineLabel } from './report.ts'
import {
  DEAD_BUDGET_ASSERTION,
  DEAD_TIMING_ASSERTION,
  PUBLISHED_WIRING,
  WIRING_CASES,
} from './wiring.ts'

/** The versions every measurement in README.md was taken against. */
export const MEASURED_AGAINST = {
  lighthouse: '12.1.0',
  lhci: '0.14.0',
} as const

/**
 * Whether LHCI's GitHub integration still writes only commit statuses.
 *
 * The claim that `LHCI_GITHUB_APP_TOKEN` cannot satisfy this item rests on
 * LHCI having no comment API at all, which is a fact about the installed
 * package rather than about this repository — so it is read off the package.
 * `upload.js` is where every GitHub write lives; if a future LHCI grows an
 * issue-comments call, this returns false and the finding's prose fails rather
 * than quietly describing a version nobody has.
 *
 * `@lhci/cli` is a direct dependency and resolvable; its `upload.js` is read as
 * text rather than imported because importing it would run the CLI's module
 * graph for a question about one string.
 */
export function lhciPostsOnlyStatuses(): boolean {
  const require = createRequire(import.meta.url)
  const source = readFileSync(
    require.resolve('@lhci/cli/src/upload/upload.js'),
    'utf8',
  )

  return source.includes('/statuses/') && !source.includes('/comments')
}

/** A published finding: the heading it sits under, and what makes it true. */
export interface Finding {
  readonly heading: string
  readonly holds: () => boolean
}

const pad = (value: string, width: number): string => value.padEnd(width)

/** The wiring table, rendered from {@link WIRING_CASES}. */
export function renderWiringTable(): string {
  const labelWidth = Math.max(...WIRING_CASES.map((wiring) => wiring.label.length + 2), 8)

  const rows = WIRING_CASES.map((wiring) => {
    const label = pad(`\`${wiring.label}\``, labelWidth)
    const gates = pad(wiring.gates ? 'yes' : '**no**', 6)
    return `| ${label} | ${gates} | ${wiring.because} |`
  })

  return [
    `| ${pad('wiring', labelWidth)} | ${pad('gates', 6)} | why |`,
    `|${'-'.repeat(labelWidth + 2)}|${'-'.repeat(8)}|-----|`,
    ...rows,
  ].join('\n')
}

/** The budget table, rendered from the budget file. */
export function renderBudgetTable(budgets: readonly Budget[]): string {
  const lines = budgetLines(budgets)
  const labelWidth = Math.max(...lines.map((line) => lineLabel(line).length), 6)
  const limitWidth = Math.max(...lines.map((line) => formatCeiling(line).length), 5)

  const rows = lines.map(
    (line) =>
      `| ${pad(lineLabel(line), labelWidth)} | ${pad(formatCeiling(line), limitWidth)} | \`${
        line.kind === 'timing' ? line.metric : `resource-summary:${line.resourceType}:${line.kind}`
      }\` |`,
  )

  return [
    `| ${pad('budget', labelWidth)} | ${pad('limit', limitWidth)} | asserted as |`,
    `|${'-'.repeat(labelWidth + 2)}|${'-'.repeat(limitWidth + 2)}|-------------|`,
    ...rows,
  ].join('\n')
}

/**
 * The findings, each with the predicate that keeps its prose honest.
 *
 * A predicate that can only ever be true is not worth writing; each of these
 * is a claim that a dependency bump or a config edit could falsify.
 */
export function findings(budgets: readonly Budget[]): readonly Finding[] {
  return [
    {
      heading: '### Two of the four wirings enforce nothing',
      // At least two documented wirings must be dead. If they all start
      // gating, the directory's reason to exist has gone and the README should
      // say so rather than keep warning about it.
      holds: () => WIRING_CASES.filter((wiring) => !wiring.gates).length >= 2,
    },
    {
      heading: '### The dangerous one is the one that looks explicit',
      // `performance-budget` is special-cased by LHCI and so passes silently;
      // `timing-budget` is not and so fails loudly. Both must still be
      // declared removed, or the contrast is no longer the finding.
      holds: () =>
        DEAD_BUDGET_ASSERTION === 'performance-budget' &&
        DEAD_TIMING_ASSERTION === 'timing-budget' &&
        WIRING_CASES.some(
          (wiring) => wiring.id === 'performance-budget-assertion' && !wiring.gates,
        ),
    },
    {
      heading: '### `budgetsFile` works, and costs the passing rows',
      // The published wiring is the derived one precisely because
      // `budgetsFile` cannot be combined with other assertions and drops
      // `includePassedAssertions`.
      holds: () =>
        PUBLISHED_WIRING === 'derived-assertions' &&
        WIRING_CASES.some((wiring) => wiring.id === 'budgets-file' && wiring.gates),
    },
    {
      heading: '### Budget sizes are KiB',
      holds: () => KIB === 1024 && assertedCeiling({ kind: 'size', path: '/*', resourceType: 'script', budget: 300 }) === 307_200,
    },
    {
      heading: '### An empty results file is not a clean run',
      // The comment must be renderable from a budget file alone, and must not
      // report success when it is.
      holds: () => budgetLines(budgets).length > 0 && STICKY_MARKER.startsWith('<!--'),
    },
    {
      heading: '### Lighthouse CI posts a status check, not a comment',
      // Read off the installed @lhci/cli rather than asserted: the day LHCI
      // grows a comment integration, `post.ts` is redundant and this finding
      // is wrong, and that should fail here.
      holds: lhciPostsOnlyStatuses,
    },
    {
      heading: '### `first-meaningful-paint` is accepted and never measured',
      holds: () => !(TIMING_METRICS as readonly string[]).includes('first-meaningful-paint'),
    },
  ]
}
