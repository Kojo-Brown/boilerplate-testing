/**
 * The measurement: nine faults, seven channels, and what each channel is worth.
 *
 * ---------------------------------------------------------------------------
 * What the table is, and what it is not
 * ---------------------------------------------------------------------------
 * Every cell below is a claim about a real trace, and `pnpm trace:check` opens
 * eight real zips on every run and checks all 56 of them. Writing the table down
 * rather than generating it is the same choice `intercept/matrix.ts` and
 * `visual/wirings.ts` make, for the same reason: a table generated from the run
 * agrees with the run by construction and can never fail. This one can, and when
 * it does either Playwright changed what it records or somebody changed the
 * fixture without noticing what it cost.
 *
 * ---------------------------------------------------------------------------
 * Verdicts are declared; presence is measured
 * ---------------------------------------------------------------------------
 * "This channel explains the failure" is a judgement, and a directory that
 * dressed a judgement up as a measurement would be worse than one that admitted
 * it. So the split is explicit:
 *
 *   - The verdict — `cause`, `symptom`, `context`, `empty` — is written here by
 *     hand, after reading the traces. It is an argument, and the README makes it
 *     in prose next to the table.
 *   - `empty` is not a judgement. A channel is empty or it is not, the parse
 *     counts it, and `check.ts` fails when a declared `empty` holds entries or a
 *     declared anything-else holds none. Every interesting finding below is
 *     carried by an `empty`, which is why that half is the measured half.
 *
 * Counts are deliberately *not* published. `covered-button` recorded twelve DOM
 * snapshots on the run this table was written from and four on another, because
 * Playwright snapshots each click retry and the number of retries is a function
 * of how loaded the machine is. A table of counts would be a table of timings
 * pretending to be a table of contents.
 */

import { CASES, CASE_NAMES, caseByName, type CaseName } from './faults.ts'
import { CHANNEL_NAMES, type ChannelName } from './channels.ts'

/** What one channel is worth for one fault. */
export const VERDICTS = ['cause', 'symptom', 'context', 'empty'] as const

export type Verdict = (typeof VERDICTS)[number]

/** What each verdict asserts, for the README's legend. */
export const VERDICT_MEANINGS: Readonly<Record<Verdict, string>> = {
  cause: 'this channel alone names the defect',
  symptom: 'shows the failure, not the defect',
  context: 'narrows or corroborates, once you have the cause',
  empty: 'no entries at all',
}

export type Row = Readonly<Record<ChannelName, Verdict>>

export type Evidence = Readonly<Record<CaseName, Row>>

export const EVIDENCE: Evidence = {
  'renamed-element': {
    // "element(s) not found" is true and unhelpful: it says the locator matched
    // nothing, not that the id it should have matched is two characters away.
    // The snapshot has `<span id="sum">` in it.
    error: 'symptom',
    actions: 'context',
    snapshot: 'cause',
    network: 'context',
    console: 'empty',
    pageerror: 'empty',
    source: 'context',
  },
  'duplicate-label': {
    // The one fault whose error message is a complete diagnosis. Strict mode
    // enumerates both matches, with a locator for each, before it gives up.
    error: 'cause',
    actions: 'context',
    snapshot: 'context',
    network: 'context',
    console: 'empty',
    pageerror: 'empty',
    source: 'context',
  },
  'covered-button': {
    // The first draft of this row said `symptom`, on the reasoning that a click
    // which times out on stability never gets as far as hit-testing. `check.ts`
    // rejected it: the call log retries the click four times and names the
    // culprit on every attempt — `<div id="veil"></div> intercepts pointer
    // events`. The answer is on the eighth line of a message whose first line is
    // `Timeout 2000ms exceeded`, which is the whole reason the `error` channel is
    // worth scrolling rather than glancing at.
    //
    // The snapshot is `context` rather than `cause` for an unobvious reason: the
    // overlay is fully transparent, so a *screenshot* of this page is a picture
    // of a perfectly clickable button. It is the snapshot's DOM, not its
    // appearance, that corroborates the call log.
    error: 'cause',
    actions: 'context',
    snapshot: 'context',
    network: 'context',
    console: 'empty',
    pageerror: 'empty',
    source: 'context',
  },
  'late-content': {
    // The one fault with no `cause` anywhere. Every channel agrees the total was
    // the placeholder at the moment the assertion gave up, and nothing in a
    // recording of a failed run can distinguish "arrives in five seconds" from
    // "never arrives". The trace bounds the defect; it does not name it.
    error: 'symptom',
    actions: 'context',
    snapshot: 'symptom',
    network: 'context',
    console: 'empty',
    pageerror: 'empty',
    source: 'context',
  },
  'failing-api': {
    // Two channels hold the cause and neither is the one the viewer opens on.
    // The page is silent about the 500; Chromium is not, and logs the failed
    // subresource with its URL whatever the page does.
    error: 'symptom',
    actions: 'context',
    snapshot: 'symptom',
    network: 'cause',
    console: 'cause',
    pageerror: 'empty',
    source: 'context',
  },
  'hanging-api': {
    // `GET /api/slow` with status -1: requested, never answered. Indistinguishable
    // from `failing-api` in every other channel, including the error message,
    // which is the same wrong count with the same timeout.
    error: 'symptom',
    actions: 'context',
    snapshot: 'symptom',
    network: 'cause',
    console: 'empty',
    pageerror: 'empty',
    source: 'context',
  },
  'throwing-script': {
    // The page error carries the TypeError and its line. The network channel is
    // `context` for an unusual reason: what it holds is the *absence* of the
    // request the other faults all make, because the script died before its
    // fetch. A missing row is evidence, and it is the only channel that has it.
    error: 'symptom',
    actions: 'context',
    snapshot: 'symptom',
    network: 'context',
    console: 'empty',
    pageerror: 'cause',
    source: 'context',
  },
  'missing-env': {
    // Five empty channels, and the only case where the terminal already had the
    // answer. `actions` is `context` rather than `empty` because the step tree
    // is there and shows the test failing before its first navigation, which is
    // the shape of a fault that never reached the browser.
    error: 'cause',
    actions: 'context',
    snapshot: 'empty',
    network: 'empty',
    console: 'empty',
    pageerror: 'empty',
    source: 'empty',
  },
}

export function verdict(name: CaseName, channel: ChannelName): Verdict {
  const row = EVIDENCE[name]

  return row[channel]
}

/** The channels that name the defect for one fault, in table order. */
export function causesFor(name: CaseName): readonly ChannelName[] {
  return CHANNEL_NAMES.filter((channel) => verdict(name, channel) === 'cause')
}

/** The faults for which a channel is empty, in table order. */
export function emptyFor(channel: ChannelName): readonly CaseName[] {
  return CASE_NAMES.filter((name) => verdict(name, channel) === 'empty')
}

/** How many of a fault's channels hold nothing. */
export function emptyCount(name: CaseName): number {
  return CHANNEL_NAMES.filter((channel) => verdict(name, channel) === 'empty').length
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`

  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n')
}

/** The catalogue: what is wrong, and what the CI log says about it. */
export function renderCaseTable(): string {
  return table(
    ['fault', 'the defect', 'what the CI log says'],
    CASES.map((entry) => [`\`${entry.name}\``, entry.defect, entry.reportedAs]),
  )
}

/** The evidence table: one row per fault, one column per channel. */
export function renderEvidenceTable(): string {
  return table(
    ['fault', ...CHANNEL_NAMES],
    CASE_NAMES.map((name) => [
      `\`${name}\``,
      ...CHANNEL_NAMES.map((channel) => verdict(name, channel)),
    ]),
  )
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * The claims `README.md` makes in prose, each as a function over the table.
 *
 * Both directions are checked in `evidence.test.ts`: a finding that stops being
 * true fails, and a heading with no finding behind it fails too, so the prose
 * cannot drift into claiming something the table no longer supports.
 */
export const FINDINGS: readonly { readonly heading: string; readonly holds: () => boolean }[] = [
  {
    heading: '## Five faults out of eight do not name themselves',
    holds: () => CASE_NAMES.filter((name) => verdict(name, 'error') !== 'cause').length === 5,
  },
  {
    heading: '## The answer is in the call log, not in the first line',
    // Exactly one fault reports to CI as a bare timeout and nevertheless has its
    // cause in the error channel, further down the same message.
    holds: () => {
      const buried = CASE_NAMES.filter(
        (name) =>
          verdict(name, 'error') === 'cause' && caseByName(name).reportedAs.includes('timeout'),
      )

      return buried.length === 1
    },
  },
  {
    heading: '## The two channels nobody opens are empty six times out of eight',
    holds: () =>
      CASE_NAMES.filter(
        (name) => verdict(name, 'console') === 'empty' && verdict(name, 'pageerror') === 'empty',
      ).length === 6,
  },
  {
    heading: '## When they are not empty, they are the answer',
    holds: () =>
      (['console', 'pageerror'] as const).every((channel) =>
        CASE_NAMES.filter((name) => verdict(name, channel) !== 'empty').every(
          (name) => verdict(name, channel) === 'cause',
        ),
      ),
  },
  {
    heading: '## Two faults are the same failure until you open the network tab',
    holds: () => {
      const network = CASE_NAMES.filter((name) => verdict(name, 'network') === 'cause')

      return (
        network.length === 2 &&
        network.every((name) => verdict(name, 'error') === 'symptom') &&
        network.every((name) => causesFor(name).includes('network'))
      )
    },
  },
  {
    heading: '## Only one fault needs the DOM snapshot',
    holds: () => {
      const snapshot = CASE_NAMES.filter((name) => verdict(name, 'snapshot') === 'cause')
      const only = snapshot[0]

      return (
        snapshot.length === 1 &&
        only !== undefined &&
        // And for that one the error channel explicitly declines to say what was
        // on the page instead, which is what leaves the snapshot alone with it.
        verdict(only, 'error') === 'symptom' &&
        causesFor(only).length === 1
      )
    },
  },
  {
    heading: '## One fault the trace cannot name',
    // Exactly one case has no `cause` cell anywhere.
    holds: () => CASE_NAMES.filter((name) => causesFor(name).length === 0).length === 1,
  },
  {
    heading: '## The emptiest trace is the one you did not need',
    holds: () => {
      const ranked = [...CASE_NAMES].sort((left, right) => emptyCount(right) - emptyCount(left))
      const emptiest = ranked[0]

      if (emptiest === undefined) {
        return false
      }

      const runnerUp = ranked[1]

      return (
        runnerUp !== undefined &&
        emptyCount(emptiest) > emptyCount(runnerUp) &&
        verdict(emptiest, 'error') === 'cause'
      )
    },
  },
]
