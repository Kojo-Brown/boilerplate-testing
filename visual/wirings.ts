/**
 * Nine ways to wire a visual-regression suite, and what each one is in a
 * position to tell you.
 *
 * ---------------------------------------------------------------------------
 * Capture and comparison are two phases, and the API hides that
 * ---------------------------------------------------------------------------
 * `toHaveScreenshot` takes one options bag holding `mask`, `animations`,
 * `fullPage`, `clip`, `threshold` and `maxDiffPixels`, which reads as six knobs
 * of one kind. They are not. The first four decide *what image is produced*;
 * the last two decide *how two images are graded*. The distinction is not
 * pedantry — it is why `mask` and `threshold` do not substitute for each other
 * however hard you tune them, and why the two most common pieces of advice
 * about a noisy suite ("mask the dynamic bits", "raise the tolerance") are
 * answers to different questions.
 *
 * So a `Wiring` below has a `capture` and a `compare`, and `capture.ts` runs
 * them as two steps: `page.screenshot(capture)` then `toMatchSnapshot(compare)`.
 * That is the same comparator `toHaveScreenshot` uses, driven one phase at a
 * time, and it is what lets the matrix share one captured buffer between the
 * wirings that differ only in tolerance.
 *
 * ---------------------------------------------------------------------------
 * One control apart
 * ---------------------------------------------------------------------------
 * Every wiring but the first names the one it was derived from and differs
 * from it in exactly one field. `wirings.test.ts` asserts that rather than
 * trusting the comment, for the reason `matrix/` and `intercept/` give: a
 * league table of nine arbitrary configurations tells you which is best and
 * nothing about why, whereas adjacent rows make each difference attributable
 * to the control that caused it.
 *
 * ---------------------------------------------------------------------------
 * The review dimension is not decoration
 * ---------------------------------------------------------------------------
 * `review` is the last field, and the three wirings that differ only in it are
 * the point of this directory's second half. A comparison that found a
 * difference has not yet done anything: what happens next is decided by the CI
 * job's `--update-snapshots` flag and by whether a human ever looks at the
 * diff. `lifecycle.test.ts` measures what each flag does to a baseline on
 * disk, against real `playwright test` runs, and `REVIEW_POLICIES` below is
 * the reading of that measurement rather than an opinion about process.
 */

import { CHANGES, type Change } from './changes.ts'

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** What image the capture phase produces. */
export interface CaptureControls {
  /** `viewport` is `page.screenshot()`; `full-page` adds `fullPage: true`. */
  readonly scope: 'viewport' | 'full-page'
  /** Whether the page's dynamic regions are filled with a solid box first. */
  readonly mask: boolean
  /** Playwright's `animations` option, verbatim. */
  readonly animations: 'allow' | 'disabled'
}

/** How the comparison phase grades two images. */
export interface CompareControls {
  /** Per-pixel colour distance under which a pixel is not counted as different. */
  readonly threshold: number
  /** How many counted pixels are allowed before the comparison fails. */
  readonly maxDiffPixels: number
}

/**
 * What the CI job does with the comparison's verdict.
 *
 *   - `blocking`    — a difference fails the job and nothing is rewritten.
 *                     `playwright test`, no flag.
 *   - `auto-update` — the job runs `--update-snapshots=changed` (or `all`), so
 *                     the baseline is rewritten to whatever this run rendered
 *                     and the job exits 0.
 *   - `approve`     — `blocking`, plus the diff is published as an artifact and
 *                     a new baseline can only reach the default branch through
 *                     a reviewed commit.
 */
export const REVIEWS = ['blocking', 'auto-update', 'approve'] as const
export type Review = (typeof REVIEWS)[number]

/** The budget the tuned wirings spend, and the number `changes.ts` bands against. */
export const PIXEL_BUDGET = 4_000

export interface Wiring {
  readonly name: string
  /** The wiring this one differs from in exactly one control, or `null`. */
  readonly derivedFrom: string | null
  /** One line, as the README's wiring table prints it. */
  readonly describes: string
  readonly capture: CaptureControls
  readonly compare: CompareControls
  readonly review: Review
}

export const WIRINGS: readonly Wiring[] = [
  {
    name: 'naive',
    derivedFrom: null,
    describes: 'screenshot the viewport, compare exactly, fail on any difference',
    capture: { scope: 'viewport', mask: false, animations: 'allow' },
    compare: { threshold: 0, maxDiffPixels: 0 },
    review: 'blocking',
  },
  {
    name: 'frozen',
    derivedFrom: 'naive',
    describes: 'the same, with CSS animations disabled',
    capture: { scope: 'viewport', mask: false, animations: 'disabled' },
    compare: { threshold: 0, maxDiffPixels: 0 },
    review: 'blocking',
  },
  {
    // Playwright's own defaults: `threshold: 0.2`, no `maxDiffPixels`, and
    // `animations: 'disabled'`, which `toHaveScreenshot` applies whether or not
    // you ask for it. This is what a suite does before anybody tunes anything.
    name: 'playwright-default',
    derivedFrom: 'frozen',
    describes: 'frozen, at Playwright’s default threshold of 0.2',
    capture: { scope: 'viewport', mask: false, animations: 'disabled' },
    compare: { threshold: 0.2, maxDiffPixels: 0 },
    review: 'blocking',
  },
  {
    name: 'masked',
    derivedFrom: 'frozen',
    describes: 'frozen, with the page’s dynamic regions masked',
    capture: { scope: 'viewport', mask: true, animations: 'disabled' },
    compare: { threshold: 0, maxDiffPixels: 0 },
    review: 'blocking',
  },
  {
    name: 'budgeted',
    derivedFrom: 'masked',
    describes: `masked, tolerating up to ${PIXEL_BUDGET.toLocaleString('en-GB')} differing pixels`,
    capture: { scope: 'viewport', mask: true, animations: 'disabled' },
    compare: { threshold: 0, maxDiffPixels: PIXEL_BUDGET },
    review: 'blocking',
  },
  {
    name: 'whole-page',
    derivedFrom: 'budgeted',
    describes: 'budgeted, capturing the whole scrollable document',
    capture: { scope: 'full-page', mask: true, animations: 'disabled' },
    compare: { threshold: 0, maxDiffPixels: PIXEL_BUDGET },
    review: 'blocking',
  },
  {
    // The wiring a team arrives at by raising the knob with the friendliest
    // name until the suite stops complaining. It keeps the budget, so it is
    // exactly one control away from the row above it.
    name: 'over-tolerant',
    derivedFrom: 'whole-page',
    describes: 'whole-page, with the threshold raised to 0.2 to quieten it',
    capture: { scope: 'full-page', mask: true, animations: 'disabled' },
    compare: { threshold: 0.2, maxDiffPixels: PIXEL_BUDGET },
    review: 'blocking',
  },
  {
    name: 'auto-updated',
    derivedFrom: 'whole-page',
    describes: 'whole-page, with CI passing --update-snapshots',
    capture: { scope: 'full-page', mask: true, animations: 'disabled' },
    compare: { threshold: 0, maxDiffPixels: PIXEL_BUDGET },
    review: 'auto-update',
  },
  {
    name: 'reviewed',
    derivedFrom: 'whole-page',
    describes: 'whole-page, with diffs published and new baselines reviewed',
    capture: { scope: 'full-page', mask: true, animations: 'disabled' },
    compare: { threshold: 0, maxDiffPixels: PIXEL_BUDGET },
    review: 'approve',
  },
]

export const WIRING_NAMES = WIRINGS.map((entry) => entry.name)

export function wiring(name: string): Wiring {
  const found = WIRINGS.find((candidate) => candidate.name === name)

  if (!found) {
    throw new Error(`no wiring named ${name}`)
  }

  return found
}

/**
 * The distinct capture configurations among the nine wirings.
 *
 * Four, not nine — which is the capture/comparison split showing up as a
 * saving rather than as an argument. `matrix.spec.ts` takes four screenshots
 * of each revision and grades all nine wirings from them.
 */
export function captureSignature(controls: CaptureControls): string {
  return `${controls.scope}/${controls.mask ? 'masked' : 'bare'}/${controls.animations}`
}

export function captureConfigurations(): readonly CaptureControls[] {
  const seen = new Map<string, CaptureControls>()

  for (const entry of WIRINGS) {
    const key = captureSignature(entry.capture)

    if (!seen.has(key)) {
      seen.set(key, entry.capture)
    }
  }

  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// The prediction
// ---------------------------------------------------------------------------

/**
 * Whether the comparison phase reports a difference, predicted from the
 * change's declared properties.
 *
 * This is the column `matrix.spec.ts` re-derives against Chromium. Every
 * branch is a claim about what Playwright does, and each is answerable by the
 * measurement rather than by reading the documentation:
 *
 *   1. **A size mismatch is not graded.** A full-page capture of a document
 *      that grew is a different-sized image, and the comparator rejects it
 *      before either tolerance applies. `over-tolerant` cannot swallow it.
 *   2. **A capture cannot grade what it did not capture.** A viewport
 *      screenshot has nothing to say about the page below it, and neither
 *      tolerance is consulted for pixels that are not in the image.
 *   3. **A mask is a solid rectangle, not a filter.** Anything inside it is
 *      erased — noise and defect alike. Anything that *moves* it is not: a
 *      bigger rectangle differs from a smaller one at every pixel between
 *      them, so masking makes a resize louder rather than quieter.
 *   4. **`animations: 'disabled'` is a control over the engine's animations.**
 *      It settles a CSS animation to the same frame both times. It has nothing
 *      to say about a width a script wrote.
 *   5. **`threshold` decides which pixels count; `maxDiffPixels` decides how
 *      many counted pixels are allowed.** They are in series, not in parallel,
 *      and the order matters: a change whose per-pixel delta is under the
 *      threshold contributes no counted pixels at all, so no budget — however
 *      small — will catch it.
 */
/**
 * Which of the six mechanisms decided this cell.
 *
 *   - `size-mismatch`     — the images are different sizes. The comparator
 *                           rejects them before consulting either tolerance,
 *                           so no `threshold` and no budget can swallow it.
 *   - `out-of-frame`      — the change is not in the captured image at all.
 *   - `masked-out`        — the mask erased it. Noise and defect alike.
 *   - `animation-settled` — `animations: 'disabled'` put the engine's
 *                           animation on the same frame in both captures.
 *   - `below-threshold`   — every changed pixel is closer to its baseline than
 *                           `threshold`, so none of them was counted. No
 *                           budget, however small, is reached.
 *   - `within-budget`     — pixels were counted, and fewer than `maxDiffPixels`.
 *   - `counted`           — pixels were counted, and too many.
 *
 * Returned rather than folded into a boolean because the seven words are the
 * content: a cell that reads `missed` is uninteresting until you know whether
 * the capture never saw it, the mask erased it, or the tolerance swallowed it,
 * and those are three different bugs with three different fixes.
 */
export const DECISIONS = [
  'size-mismatch',
  'out-of-frame',
  'masked-out',
  'animation-settled',
  'below-threshold',
  'within-budget',
  'counted',
] as const

export type Decision = (typeof DECISIONS)[number]

/**
 * What the comparison phase reports, and why, predicted from the change's
 * declared properties.
 *
 * This is the column `matrix.spec.ts` re-derives against Chromium. Every
 * branch is a claim about what Playwright does, and each is answerable by the
 * measurement rather than by reading the documentation:
 *
 *   1. **A size mismatch is not graded.** A full-page capture of a document
 *      that grew is a different-sized image, and the comparator rejects it
 *      before either tolerance applies. `over-tolerant` cannot swallow it.
 *   2. **A capture cannot grade what it did not capture.** A viewport
 *      screenshot has nothing to say about the page below it.
 *   3. **A mask is a solid rectangle, not a filter.** Anything inside it is
 *      erased. Anything that *moves* it is not: a bigger rectangle differs
 *      from a smaller one at every pixel between them, so masking makes a
 *      resize louder rather than quieter.
 *   4. **`animations: 'disabled'` is a control over the engine's animations.**
 *      It settles a CSS animation to the same frame both times. It has nothing
 *      to say about a width a script wrote.
 *   5. **`threshold` decides which pixels count; `maxDiffPixels` decides how
 *      many counted pixels are allowed.** They are in series, not in parallel,
 *      and the order is what surprises people: a change whose per-pixel delta
 *      is under the threshold contributes no counted pixels at all, so no
 *      budget — however small — will catch it.
 */
export function decide(subject: Wiring, target: Change): Decision {
  // (1)
  if (target.region === 'page-height') {
    return subject.capture.scope === 'full-page' ? 'size-mismatch' : 'out-of-frame'
  }

  // (2)
  if (target.region === 'below-fold' && subject.capture.scope !== 'full-page') {
    return 'out-of-frame'
  }

  // (3)
  if (subject.capture.mask && target.mask === 'inside') {
    return 'masked-out'
  }

  // (4)
  if (target.motion === 'css' && subject.capture.animations === 'disabled') {
    return 'animation-settled'
  }

  // (5), first half: the threshold decides whether any pixel is counted.
  const survivesThreshold =
    target.delta === 'loud' ||
    (target.delta === 'shade' && subject.compare.threshold < 0.2) ||
    (target.delta === 'hairline' && subject.compare.threshold === 0)

  if (!survivesThreshold) {
    return 'below-threshold'
  }

  // (5), second half: the budget caps how many counted pixels are allowed.
  // A masked element that grew is `over-budget` by construction — the two
  // rectangles differ by more than the budget — so the band is read from the
  // change either way.
  if (subject.compare.maxDiffPixels > 0 && target.area === 'under-budget') {
    return 'within-budget'
  }

  return 'counted'
}

/** The decisions under which the comparison reports a difference. */
const FLAGGING: readonly Decision[] = ['size-mismatch', 'counted']

export function flags(subject: Wiring, target: Change): boolean {
  return FLAGGING.includes(decide(subject, target))
}

/**
 * Whether this cell's answer was decided by the pixel budget.
 *
 * `matrix.spec.ts` uses it to check that the `area` bands in `changes.ts` have
 * room: only the cells that actually consult a band need one that is stable
 * across Chromium builds, and measuring a band under a capture that masks or
 * settles the change away would measure nothing.
 */
export function consultsBudget(subject: Wiring, target: Change): boolean {
  if (subject.compare.maxDiffPixels === 0) {
    return false
  }

  const decision = decide(subject, target)

  return decision === 'within-budget' || decision === 'counted'
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * What a cell is worth to the team running it.
 *
 * Five words rather than a boolean, because "the comparison found a
 * difference" is two good outcomes and two bad ones depending on what the
 * difference was and what the job then did with it.
 *
 *   - `caught`      — a regression was flagged and the job failed. What you
 *                     bought the suite for.
 *   - `missed`      — a regression was not flagged. The suite was green and
 *                     wrong.
 *   - `absorbed`    — a regression was flagged and the baseline was rewritten
 *                     to match it. Strictly worse than `missed`: the defect is
 *                     now the reference, so no future run can catch it either.
 *   - `false-alarm` — noise was flagged and the job failed. The outcome that
 *                     ends with somebody raising the threshold.
 *   - `triaged`     — noise was flagged, the diff was published, and a new
 *                     baseline went in through review. A cost, but a bounded
 *                     one that does not weaken the gate.
 *   - `clean`       — noise was not flagged. Nothing happened, correctly.
 */
export const OUTCOMES = ['caught', 'missed', 'absorbed', 'false-alarm', 'triaged', 'clean'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** The outcomes a wiring is judged to have got right. */
export const GOOD_OUTCOMES: readonly Outcome[] = ['caught', 'triaged', 'clean']

/**
 * The review layer, as `lifecycle.test.ts` measures it.
 *
 * `auto-update` is the only row that changes a *flagged* cell's meaning, and
 * it changes it in both directions at once: it makes the noise cells quiet and
 * the regression cells permanent. That is the trade nobody states when they
 * put `--update-snapshots` in a workflow file to stop the suite being annoying.
 */
export const REVIEW_POLICIES: Readonly<Record<Review, string>> = {
  blocking: 'a difference fails the job; the baseline on disk is untouched',
  'auto-update': 'the baseline is rewritten to this run’s render and the job exits 0',
  approve: 'a difference fails the job, the diff is published, and a new baseline needs a review',
}

export function outcome(subject: Wiring, target: Change): Outcome {
  const flagged = flags(subject, target)

  if (target.kind === 'regression') {
    if (!flagged) {
      return 'missed'
    }

    return subject.review === 'auto-update' ? 'absorbed' : 'caught'
  }

  if (!flagged) {
    return 'clean'
  }

  switch (subject.review) {
    case 'auto-update':
      return 'clean'
    case 'approve':
      return 'triaged'
    case 'blocking':
      return 'false-alarm'
  }
}

export function scoreOf(subject: Wiring): number {
  return CHANGES.filter((target) => GOOD_OUTCOMES.includes(outcome(subject, target))).length
}

// ---------------------------------------------------------------------------
// Rendering
//
// The README's tables are printed from these, not checked against them — the
// discipline `intercept/`, `matrix/` and `a11y/` established. There is no
// version of `readme.test.ts` that agrees with a published table holding a
// wrong cell or a row somebody reordered.
// ---------------------------------------------------------------------------

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

/** The catalogue: what is planted where, and what kind of thing it is. */
export function renderChangeTable(): string {
  return table(
    ['change', 'kind', 'what it is', 'region', 'mask', 'delta', 'area', 'motion'],
    CHANGES.map((entry) => [
      `\`${entry.id}\``,
      entry.kind,
      entry.describes,
      `\`${entry.region}\``,
      `\`${entry.mask}\``,
      `\`${entry.delta}\``,
      `\`${entry.area}\``,
      `\`${entry.motion}\``,
    ]),
  )
}

/** The wirings, their controls, and what each one scores. */
export function renderWiringTable(): string {
  return table(
    ['wiring', 'derived from', 'scope', 'mask', 'animations', 'threshold', 'maxDiffPixels', 'review', 'score'],
    WIRINGS.map((entry) => [
      `\`${entry.name}\``,
      entry.derivedFrom === null ? '—' : `\`${entry.derivedFrom}\``,
      entry.capture.scope,
      entry.capture.mask ? 'on' : 'off',
      entry.capture.animations,
      String(entry.compare.threshold),
      entry.compare.maxDiffPixels === 0 ? '0' : entry.compare.maxDiffPixels.toLocaleString('en-GB'),
      entry.review,
      `**${scoreOf(entry)} / ${CHANGES.length}**`,
    ]),
  )
}

/** The full grid: every change against every wiring. */
export function renderMatrix(): string {
  return table(
    ['change', ...WIRINGS.map((entry) => `\`${entry.name}\``)],
    CHANGES.map((target) => [
      `\`${target.id}\``,
      ...WIRINGS.map((subject) => outcome(subject, target)),
    ]),
  )
}
