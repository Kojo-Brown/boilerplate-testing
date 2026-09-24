/**
 * The part of an end-to-end accessibility scan that is not a browser.
 *
 * Kept free of `@axe-core/playwright` on purpose: everything here is a
 * function from an `AxeResults` to a decision, so it is testable in `pnpm test`
 * on a machine with no browser at all, and `journeyScan.ts` next door is the
 * thin part that actually drives one.
 *
 * Three things live here, and each exists because the canonical two-line scan
 * gets it wrong:
 *
 *   - **`findingsFrom`** reads `incomplete` as well as `violations`. axe puts a
 *     result there when it noticed something and declined to decide, and two
 *     of the twelve defects in `page.ts` land in that bucket — including a
 *     dangling `aria-describedby`, which is the commonest spelling of a broken
 *     error message there is. `expect(results.violations).toEqual([])` throws
 *     those answers away.
 *   - **`DISABLED_BY_DEFAULT`** names the rules axe ships switched off.
 *     `axe.getRules()` lists them like any other, so a rule that never runs
 *     looks active to anyone who checks that way.
 *   - **`fingerprint` / `dedupe`** make per-state scanning affordable to read.
 *     A defect in a header is re-reported in every state the journey passes
 *     through — the fixture's contrast failure is found six times — and a
 *     report that says that is a report people stop reading.
 */

import type { AxeResults, ImpactValue, Result } from 'axe-core'

/**
 * The axe-core rules that exist and do not run.
 *
 * Hardcoded rather than read out of the library, because the only way to ask
 * axe is `axe._audit`, and a private field is not something a scan in anyone's
 * CI should depend on. `scan.test.ts` asserts this list against that field, so
 * it is audited rather than trusted: when a future axe-core enables
 * `target-size`, the suite fails here instead of quietly over-reporting.
 *
 * `target-size` is the one that matters in practice — it is WCAG 2.2 AA, it is
 * the commonest defect on a phone, and it is off.
 */
export const DISABLED_BY_DEFAULT: readonly string[] = [
  'aria-roledescription',
  'audio-caption',
  'color-contrast-enhanced',
  'duplicate-id',
  'duplicate-id-active',
  'identical-links-same-purpose',
  'landmark-complementary-is-top-level',
  'meta-refresh-no-exceptions',
  'target-size',
]

/** `{ 'target-size': { enabled: true }, … }`, for `AxeBuilder#options`. */
export function enableAll(rules: readonly string[] = DISABLED_BY_DEFAULT): Record<
  string,
  { enabled: boolean }
> {
  return Object.fromEntries(rules.map((rule) => [rule, { enabled: true }]))
}

/** Which axe bucket a finding came out of. */
export type Bucket = 'violation' | 'incomplete'

export interface Finding {
  readonly rule: string
  readonly bucket: Bucket
  readonly impact: ImpactValue | null
  /** The journey state the scan was taken in. */
  readonly state: string
  /** The node's CSS selector, as axe reports it. */
  readonly target: string
  readonly html: string
  readonly summary: string
}

function flatten(results: readonly Result[], bucket: Bucket, state: string): Finding[] {
  return results.flatMap((result) =>
    result.nodes.map((node) => ({
      rule: result.id,
      bucket,
      impact: result.impact ?? null,
      state,
      target: node.target.map((part) => (Array.isArray(part) ? part.join(' ') : part)).join(' '),
      html: node.html,
      summary: node.failureSummary ?? result.help,
    })),
  )
}

export interface FindingsOptions {
  /**
   * Whether `results.incomplete` counts. Defaults to `true`, which is the
   * opposite of every example on the internet and the reason this helper
   * exists — see the note at the top of the file.
   */
  readonly includeIncomplete?: boolean
}

/** Every node axe had something to say about, flattened and labelled. */
export function findingsFrom(
  results: AxeResults,
  state: string,
  options: FindingsOptions = {},
): readonly Finding[] {
  const includeIncomplete = options.includeIncomplete ?? true

  return [
    ...flatten(results.violations, 'violation', state),
    ...(includeIncomplete ? flatten(results.incomplete, 'incomplete', state) : []),
  ]
}

/**
 * What makes two findings the same defect.
 *
 * Rule and node, deliberately not state: the point of the fingerprint is that
 * the header's contrast failure found in six states is one defect found six
 * times, and a fingerprint that included the state would say the opposite.
 */
export function fingerprint(finding: Finding): string {
  return `${finding.rule}@${finding.target}`
}

/**
 * One entry per distinct defect, keeping the first sighting and recording
 * every state it was seen in.
 */
export function dedupe(findings: readonly Finding[]): readonly (Finding & {
  readonly states: readonly string[]
})[] {
  const order: string[] = []
  const first = new Map<string, Finding>()
  const states = new Map<string, string[]>()

  for (const finding of findings) {
    const key = fingerprint(finding)

    if (!first.has(key)) {
      first.set(key, finding)
      order.push(key)
    }

    const seen = states.get(key) ?? []

    if (!seen.includes(finding.state)) {
      states.set(key, [...seen, finding.state])
    }
  }

  return order.map((key) => {
    const finding = first.get(key)

    if (!finding) {
      throw new Error(`dedupe lost ${key}`)
    }

    return { ...finding, states: states.get(key) ?? [] }
  })
}

/** A failure message that names the state, which is the part that is hard to guess. */
export function format(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return 'no accessibility findings'
  }

  return dedupe(findings)
    .map((finding) => {
      const where = finding.states.join(', ')
      const impact = finding.impact?.toUpperCase() ?? 'UNKNOWN'

      return (
        `[${impact}] ${finding.rule} (${finding.bucket}) in ${where}\n` +
        `  target: ${finding.target}\n` +
        `  html:   ${finding.html}\n` +
        `  ${finding.summary.split('\n').join('\n  ')}`
      )
    })
    .join('\n\n')
}

/** The distinct rules a set of findings names, sorted. */
export function rulesIn(findings: readonly Finding[]): readonly string[] {
  return [...new Set(findings.map((finding) => finding.rule))].sort()
}
