/**
 * The flakiness dashboard: Markdown, because that is where people will read it.
 *
 * ---------------------------------------------------------------------------
 * Why Markdown and not a web page
 * ---------------------------------------------------------------------------
 * A dashboard nobody opens is a dashboard that does not exist, and the two
 * places a CI reader already is are the job summary and the pull request. Both
 * render Markdown. `$GITHUB_STEP_SUMMARY` takes this output verbatim, and
 * `lighthouse/comment.ts` next door posts the same kind of thing to a PR.
 *
 * ---------------------------------------------------------------------------
 * What it shows, and what it deliberately does not
 * ---------------------------------------------------------------------------
 * The table is ranked by `history.ts`'s classification first and its smoothed
 * rate second, so the top of the list is the test most worth looking at rather
 * than the test with the highest raw percentage — which, as `history.ts`
 * explains, is reliably a permanently broken test with four attempts behind it.
 *
 * Three columns are the ones people actually act on: how often the test flaked
 * (`runs`, not attempts — a reader thinks in builds), the trend, and the last
 * error. A sparkline is drawn per run rather than per attempt for the same
 * reason.
 *
 * There is no "flakiest test overall" headline number. A single percentage over
 * a suite goes down when somebody adds a thousand stable tests, which makes it
 * a measure of suite size.
 */

import type { RunOutcome, TestHistory } from './history.ts'
import { rank } from './history.ts'
import type { Judgement } from './quarantine.ts'
import { keyOf } from './quarantine.ts'

export interface DashboardInput {
  readonly histories: readonly TestHistory[]
  readonly judgements: readonly Judgement[]
  /** Runs the history was built from, for the header. */
  readonly runs: number
  readonly generatedOn: string
}

const PERCENT = (value: number): string => `${(value * 100).toFixed(1)}%`

const BADGE: Readonly<Record<TestHistory['classification'], string>> = {
  flaky: '🟠 flaky',
  broken: '🔴 broken',
  fixed: '🟢 fixed',
  stable: '⚪ stable',
}

/**
 * A run-by-run sparkline, oldest first.
 *
 * Three states and not two: a run the test passed outright, a run it passed
 * only after a retry, and a run it failed. Collapsing the middle one into
 * "passed" is how a flaky suite comes to look green, and it is the whole
 * subject of this directory.
 */
export function sparkline(runs: readonly RunOutcome[]): string {
  return runs.map((run) => (run.ended === 'failed' ? '×' : run.retried ? '!' : '·')).join('')
}

/** One Markdown table of the tests worth looking at, plus the quarantine section. */
export function renderDashboard(input: DashboardInput): string {
  const { histories, judgements, runs, generatedOn } = input
  const interesting = rank(histories).filter((history) => history.classification !== 'stable')
  const quarantined = new Set(judgements.map((judgement) => keyOf(judgement.entry)))

  const lines: string[] = ['## Flakiness', '']

  lines.push(
    `${String(histories.length)} tests over ${String(runs)} ${runs === 1 ? 'run' : 'runs'}, as of ${generatedOn}.`,
    '',
  )

  if (interesting.length === 0) {
    lines.push('No test failed an attempt in this window.', '')
  } else {
    lines.push(
      '| Test | | Flaked | Attempts | Rate | Trend | Streak | Last failure |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    )

    for (const history of interesting) {
      const name = quarantined.has(keyOf(history)) ? `${history.name} _(quarantined)_` : history.name

      lines.push(
        row([
          `\`${name}\``,
          BADGE[history.classification],
          `${String(history.flakyRuns)}/${String(history.runs)}`,
          `${String(history.failures)}/${String(history.attempts)}`,
          PERCENT(history.failureRate),
          `\`${sparkline(history.timeline)}\``,
          String(history.passStreak),
          history.lastError === undefined ? '—' : `\`${truncate(history.lastError, 60)}\``,
        ]),
      )
    }

    lines.push('')
    lines.push(
      '`Flaked` counts runs the test passed only after a retry; `Rate` is over attempts, not runs. In `Trend`, oldest run first: `·` passed, `!` passed on a retry, `×` failed. A test that fails every attempt is 🔴 rather than 🟠: it is not flaky, it is failing.',
      '',
    )
  }

  lines.push(...renderQuarantine(judgements))

  return lines.join('\n')
}

/** The quarantine section: what is in the registry and what the automation says about it. */
export function renderQuarantine(judgements: readonly Judgement[]): readonly string[] {
  if (judgements.length === 0) {
    return ['### Quarantine', '', 'The registry is empty.', '']
  }

  const lines: string[] = [
    '### Quarantine',
    '',
    '| Test | Owner | Expires | Verdict | |',
    '| --- | --- | --- | --- | --- |',
  ]

  const mark: Readonly<Record<Judgement['decision'], string>> = {
    hold: '⏳ hold',
    release: '🟢 release',
    escalate: '🔴 escalate',
    expired: '⌛ expired',
    orphan: '👻 orphan',
    unevidenced: '❔ unevidenced',
  }

  for (const judgement of judgements) {
    lines.push(
      row([
        `\`${judgement.entry.name}\``,
        judgement.entry.owner,
        judgement.entry.expiresOn,
        mark[judgement.decision],
        judgement.because,
      ]),
    )
  }

  lines.push('')

  const actionable = judgements.filter((judgement) => judgement.decision !== 'hold')

  if (actionable.length > 0) {
    lines.push(
      `${String(actionable.length)} ${actionable.length === 1 ? 'entry needs' : 'entries need'} action — \`pnpm flake:check\` fails until ${actionable.length === 1 ? 'it is' : 'they are'} resolved.`,
      '',
    )
  }

  return lines
}

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`

function truncate(value: string, limit: number): string {
  const flat = value.replaceAll('|', '\\|').replaceAll('\n', ' ')

  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}
