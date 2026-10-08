/**
 * Rendering a budget report as the body of a pull-request comment.
 *
 * ---------------------------------------------------------------------------
 * What a budget comment is for
 * ---------------------------------------------------------------------------
 * The check already says red or green. A comment that repeats that is noise on
 * every pull request, and a reviewer learns to scroll past it — which is worse
 * than not having one, because the one time it matters it has already been
 * trained away. So this body is built around the two things the check cannot
 * say:
 *
 *   1. **How close the passing rows are.** A budget that is 2% under is the
 *      next pull request's failure, and the only place that is visible is a
 *      table of headroom. This is the reason the config sets
 *      `includePassedAssertions` — see report.ts.
 *   2. **Which rows nobody measured.** Rendered as a pass, a line whose audit
 *      did not run is how a budget stops being enforced quietly.
 *
 * Everything else is kept collapsed. A green run renders one line and a
 * `<details>`; a red one puts the breaches above the fold and nothing else.
 *
 * ---------------------------------------------------------------------------
 * Sticky, not appended
 * ---------------------------------------------------------------------------
 * The comment is updated in place, keyed by {@link STICKY_MARKER} in an HTML
 * comment. A workflow that posts a fresh comment per run leaves a pull request
 * with eleven budget comments, ten of them wrong, and the reviewer has to work
 * out which is current from the timestamps. `post.ts` finds the existing one by
 * this marker and PATCHes it.
 *
 * The marker is deliberately not "the first comment by the bot": that is the
 * usual implementation and it collides with every other bot sharing the
 * `github-actions` identity.
 */

import {
  formatCeiling,
  formatValue,
  lineLabel,
  type AssertionResult,
  type BudgetReport,
  type BudgetRow,
} from './report.ts'

/**
 * The hidden key that makes the comment updatable.
 *
 * Changing it orphans every comment already posted, so it is treated as part
 * of the published contract and `comment.test.ts` pins the literal.
 */
export const STICKY_MARKER = '<!-- lighthouse-budgets -->'

/** GitHub rejects an issue comment body over this many characters. */
export const MAX_COMMENT_LENGTH = 65_536

/** Context the comment needs that the report itself does not carry. */
export interface CommentContext {
  /** Short commit SHA the run audited. */
  readonly sha: string
  /** How many Lighthouse runs were collected per URL, for the median note. */
  readonly runs: number
  /** Link to the workflow run, so a reader can get to the HTML reports. */
  readonly runUrl?: string
  /** URLs audited, in the order the config lists them. */
  readonly urls: readonly string[]
}

const ICON: Readonly<Record<BudgetRow['status'], string>> = {
  passed: '✅',
  breached: '❌',
  'not-measured': '⚠️',
}

/** Headroom as a percentage of the budget; negative means over. */
export function headroom(row: BudgetRow): number | null {
  if (row.actual === null || row.ceiling === 0) return null
  return ((row.ceiling - row.actual) / row.ceiling) * 100
}

function headroomCell(row: BudgetRow): string {
  const margin = headroom(row)
  if (margin === null) return '—'
  const sign = margin >= 0 ? '' : '+'
  // Over budget reads better as "how much over" than as negative headroom.
  return margin >= 0 ? `${margin.toFixed(0)}% under` : `${sign}${(-margin).toFixed(0)}% over`
}

function row(budgetRow: BudgetRow): string {
  const measured =
    budgetRow.actual === null ? '_not measured_' : formatValue(budgetRow.line, budgetRow.actual)

  const label = budgetRow.documentationLink
    ? `[${lineLabel(budgetRow.line)}](${budgetRow.documentationLink})`
    : lineLabel(budgetRow.line)

  return `| ${ICON[budgetRow.status]} ${label} | ${formatCeiling(budgetRow.line)} | ${measured} | ${headroomCell(budgetRow)} |`
}

const TABLE_HEAD = ['| budget | limit | measured | headroom |', '| --- | --- | --- | --- |']

function table(rows: readonly BudgetRow[]): string[] {
  return [...TABLE_HEAD, ...rows.map(row)]
}

/** The one-line summary, which is also what a reader sees in a notification. */
export function headline(report: BudgetReport): string {
  if (report.breached > 0) {
    const plural = report.breached === 1 ? 'budget' : 'budgets'
    return `**${report.breached} ${plural} over limit.**`
  }
  if (report.notMeasured > 0) {
    const plural = report.notMeasured === 1 ? 'budget was' : 'budgets were'
    return `**${report.notMeasured} ${plural} not measured.** Nothing breached, but an unmeasured budget is not a budget that passed.`
  }
  if (report.otherFailures.length > 0) {
    return `**Every budget met**, but ${report.otherFailures.length} other assertion(s) failed.`
  }
  return `**Every budget met.** ${report.passed} of ${report.passed} within limit.`
}

function otherFailureLines(failures: readonly AssertionResult[]): string[] {
  if (failures.length === 0) return []

  return [
    '',
    '#### Other failing assertions',
    '',
    '| assertion | expected | measured |',
    '| --- | --- | --- |',
    ...failures.map((failure) => {
      const id =
        failure.auditProperty === undefined
          ? failure.auditId
          : `${failure.auditId}:${failure.auditProperty}`
      return `| ${id} | ${failure.operator} ${failure.expected} | ${failure.actual} |`
    }),
  ]
}

function footer(context: CommentContext): string[] {
  const where =
    context.urls.length === 1
      ? `\`${context.urls[0] ?? ''}\``
      : `${context.urls.length} URLs`

  const median = context.runs > 1 ? `median of ${context.runs} runs` : 'single run'
  const link = context.runUrl === undefined ? '' : ` · [workflow run](${context.runUrl})`

  return ['', `<sub>${where} · ${median} · \`${context.sha}\`${link}</sub>`]
}

/**
 * Render the comment body.
 *
 * The layout is driven by the verdict rather than fixed: breaches go above the
 * fold because they are the reason to read it, and the full table is collapsed
 * on a green run because on a green run nobody needs it open.
 */
export function renderComment(report: BudgetReport, context: CommentContext): string {
  const lines: string[] = [STICKY_MARKER, '', '### Lighthouse budgets', '', headline(report), '']

  const breaches = report.rows.filter((entry) => entry.status === 'breached')
  const unmeasured = report.rows.filter((entry) => entry.status === 'not-measured')

  if (breaches.length > 0) {
    lines.push(...table(breaches))
  }

  if (unmeasured.length > 0) {
    if (breaches.length > 0) lines.push('', '#### Not measured', '')
    lines.push(...table(unmeasured))
    lines.push(
      '',
      'A budget line with no result means its audit did not run on any audited URL.',
      'Lighthouse CI skips an audit it cannot read rather than failing it, so these',
      'rows would otherwise be invisible. See `lighthouse/report.ts`.',
    )
  }

  lines.push(...otherFailureLines(report.otherFailures))

  // The full table, always available, open only when it is not the whole story.
  const open = breaches.length === 0 && unmeasured.length === 0 ? '' : ' open'
  lines.push(
    '',
    `<details${open}>`,
    `<summary>All ${report.rows.length} budgets</summary>`,
    '',
    ...table(report.rows),
    '',
    '</details>',
  )

  lines.push(...footer(context))

  return truncate(lines.join('\n'))
}

/**
 * Keep the body inside GitHub's limit.
 *
 * A budget file big enough to hit 65_536 characters is unlikely, but the
 * failure mode if it happens is a 422 from the API and no comment at all — so
 * the table is cut rather than the post lost. The marker has to survive, or the
 * next run posts a second comment instead of updating this one.
 */
export function truncate(body: string): string {
  if (body.length <= MAX_COMMENT_LENGTH) return body

  const notice = '\n\n_Comment truncated._'
  return `${body.slice(0, MAX_COMMENT_LENGTH - notice.length)}${notice}`
}
