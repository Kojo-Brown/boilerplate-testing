/**
 * The catalogue: thirteen ways a rendered page differs from the last time it
 * was rendered, and which of them anybody wanted to know about.
 *
 * ---------------------------------------------------------------------------
 * Why the list has two kinds in it
 * ---------------------------------------------------------------------------
 * Every other detection matrix in this repository scores one thing: does the
 * wiring find the defect. A visual-regression suite cannot be scored that way,
 * because the failure that kills it in practice is the opposite one. A suite
 * that flags a regression and also flags the clock in the header is not a
 * suite with one bug in it; it is a suite whose diffs nobody reads, and within
 * a month somebody raises the tolerance until it stops talking. So the
 * catalogue holds `regression`s, which a wiring should flag, and `noise`,
 * which the same wiring should not, and the score below counts a wiring right
 * on both — a table with only the first column would rank the useless
 * `naive` wiring top.
 *
 * ---------------------------------------------------------------------------
 * One mutation at a time, and everything else held still
 * ---------------------------------------------------------------------------
 * `subject.ts` renders the same document for every change but one region. The
 * stamp in the header only varies for `stamp-text`, the avatar only for
 * `avatar-tint`, the animations only for the two phase entries. That is not a
 * tidier version of a real page — a real page varies in all of them at once —
 * it is what makes a cell attributable: a flagged cell names the mutation that
 * caused it rather than whichever varying region happened to be loudest.
 *
 * It is also what makes this directory deterministic. Nothing here reads a
 * clock, a random source or a scheduler: the varying regions are driven by a
 * `nonce` the caller passes, so "this render differs from the last one" is an
 * arithmetic fact rather than a timing one, and `determinism/registry.ts`
 * gains no rows. The nondeterminism is the *subject*, so it is modelled
 * explicitly instead of being waited for.
 *
 * ---------------------------------------------------------------------------
 * The declared properties are the model's inputs
 * ---------------------------------------------------------------------------
 * `wirings.ts` predicts each cell from the five fields below, and
 * `matrix.spec.ts` re-derives every cell against Chromium and fails if the
 * prediction was wrong. So these fields are claims about the fixture, not
 * descriptions of it, and `subject.test.ts` audits each one against the
 * generated HTML.
 */

/** Regressions should be flagged; noise should not. */
export const CHANGE_KINDS = ['regression', 'noise'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/**
 * Where in the page the change lives, relative to an 800×600 viewport.
 *
 * `page-height` is its own value rather than a flag, because a change to the
 * document's height is not a change the comparator grades: a full-page capture
 * of a taller document is a different-sized image, and a size mismatch fails
 * before either tolerance is consulted. See `wirings.ts`.
 */
export const REGIONS = ['above-fold', 'below-fold', 'page-height'] as const
export type Region = (typeof REGIONS)[number]

/**
 * How the change interacts with a mask over the page's dynamic regions.
 *
 * Three values because masking has three different answers, and only the first
 * is the one people expect:
 *
 *   - `outside`  — not under a mask; the mask is irrelevant to it.
 *   - `inside`   — under the mask, and it does not move the masked box, so the
 *                  mask erases it. This is the blind spot.
 *   - `resizes`  — under the mask, and it changes the masked element's
 *                  bounding box. The mask is a solid rectangle, so a bigger
 *                  box is a bigger rectangle: masking does not hide this and
 *                  in fact makes it louder than it was unmasked.
 */
export const MASK_RELATIONS = ['outside', 'inside', 'resizes'] as const
export type MaskRelation = (typeof MASK_RELATIONS)[number]

/**
 * The lowest `threshold` at which the comparator stops counting the change's
 * pixels as different.
 *
 * Playwright's `threshold` is a per-pixel colour distance in YIQ space: a
 * pixel whose distance from its baseline is under the threshold is not counted
 * as different at all. So this field is a property of the *colour delta*, not
 * of the area, and it is why a change can be invisible to the default
 * configuration no matter how much of the screen it covers.
 *
 * The bands are the ones `calibration.spec.ts` measures, rounded outward so a
 * cell is never decided by a value near a boundary:
 *
 *   - `hairline` — survives only `threshold: 0`.
 *   - `shade`    — survives `0.1`, gone by `0.2`. A neighbouring shade of the
 *                  same hue, which is what a token drift looks like.
 *   - `loud`     — survives `0.3`. A different colour.
 */
export const DELTA_BANDS = ['hairline', 'shade', 'loud'] as const
export type DeltaBand = (typeof DELTA_BANDS)[number]

/**
 * How many pixels the change moves, against the 4,000-pixel budget the
 * `budgeted` wiring spends.
 *
 * Two bands rather than a number, and the gap between them is deliberately
 * enormous — every `over-budget` change here moves at least 6,000 pixels and
 * every `under-budget` one fewer than 1,500. A band that a font-hinting
 * difference between two Chromium builds could cross would make this whole
 * table a property of the machine that ran it.
 */
export const AREA_BANDS = ['under-budget', 'over-budget'] as const
export type AreaBand = (typeof AREA_BANDS)[number]

/**
 * Whether the engine's animation machinery is what produces the difference.
 *
 * `css` is a CSS animation, which `animations: 'disabled'` fast-forwards (if
 * finite) or cancels to its first frame (if infinite) — either way, to the
 * same frame both times. `script` is a width written by a `requestAnimationFrame`
 * callback, which that option does not reach, because it is an option about
 * animations the engine is running and not about paint in general. `none` is
 * everything else.
 */
export const MOTION_SOURCES = ['none', 'css', 'script'] as const
export type MotionSource = (typeof MOTION_SOURCES)[number]

export interface Change {
  readonly id: string
  readonly kind: ChangeKind
  /** One line, as the README's catalogue table prints it. */
  readonly describes: string
  readonly region: Region
  readonly mask: MaskRelation
  readonly delta: DeltaBand
  readonly area: AreaBand
  readonly motion: MotionSource
}

export const CHANGES: readonly Change[] = [
  // -------------------------------------------------------------------------
  // Regressions
  // -------------------------------------------------------------------------
  {
    id: 'brand-shade',
    kind: 'regression',
    describes: 'the brand bar moves one step along its own ramp (#2563eb → #3b82f6)',
    region: 'above-fold',
    mask: 'outside',
    delta: 'shade',
    area: 'over-budget',
    motion: 'none',
  },
  {
    id: 'brand-hairline',
    kind: 'regression',
    describes: 'the brand bar moves one unit in one channel (#2563eb → #2563ec)',
    region: 'above-fold',
    mask: 'outside',
    delta: 'hairline',
    area: 'over-budget',
    motion: 'none',
  },
  {
    id: 'status-inverted',
    kind: 'regression',
    describes: 'the “Paid” pill renders in the error colour (#16a34a → #dc2626)',
    region: 'above-fold',
    mask: 'outside',
    delta: 'loud',
    area: 'over-budget',
    motion: 'none',
  },
  {
    id: 'control-removed',
    kind: 'regression',
    describes: 'the Export button is gone, in a row that keeps its height',
    region: 'above-fold',
    mask: 'outside',
    delta: 'loud',
    area: 'over-budget',
    motion: 'none',
  },
  {
    id: 'stamp-recoloured',
    kind: 'regression',
    describes: 'the header stamp renders in the error colour, in a box of unchanged size',
    region: 'above-fold',
    mask: 'inside',
    delta: 'loud',
    area: 'under-budget',
    motion: 'none',
  },
  {
    id: 'stamp-enlarged',
    kind: 'regression',
    describes: 'the header stamp doubles in size, so its box grows',
    region: 'above-fold',
    mask: 'resizes',
    delta: 'loud',
    area: 'over-budget',
    motion: 'none',
  },
  {
    // `hairline`, and the first two drafts both had it wrong — `loud`, then
    // `shade`, then the calibration. #f3f4f6 → #fee2e2 is a neutral panel
    // turning error-pink, which no reviewer would miss and which survives only
    // `threshold: 0`: to a comparator working in YIQ it is the same size of
    // change as adding one to a blue channel. Light-on-light is where a
    // threshold does its quietest damage. The matrix could not have caught
    // this, because the wirings only use 0 and 0.2 and the two wrong bands
    // predict the same thing at both — which is why `calibration.spec.ts`
    // measures this exact pair on flat colour instead of a representative one.
    id: 'panel-recoloured',
    kind: 'regression',
    describes: 'the support panel below the fold renders on an error background',
    region: 'below-fold',
    mask: 'outside',
    delta: 'hairline',
    area: 'over-budget',
    motion: 'none',
  },
  {
    id: 'page-grew',
    kind: 'regression',
    describes: 'a duplicated row makes the document 96px taller',
    region: 'page-height',
    mask: 'outside',
    delta: 'loud',
    area: 'over-budget',
    motion: 'none',
  },

  // -------------------------------------------------------------------------
  // Noise
  // -------------------------------------------------------------------------
  {
    id: 'stamp-text',
    kind: 'noise',
    describes: 'the header stamp reads a different time, as it does on every render',
    region: 'above-fold',
    mask: 'inside',
    delta: 'loud',
    area: 'under-budget',
    motion: 'none',
  },
  {
    id: 'avatar-tint',
    kind: 'noise',
    describes: 'the generated avatar comes back a different colour',
    region: 'above-fold',
    mask: 'inside',
    delta: 'loud',
    area: 'under-budget',
    motion: 'none',
  },
  {
    id: 'subpixel-jitter',
    kind: 'noise',
    describes: 'the body copy sits 0.4px to the right, re-hinting every glyph',
    region: 'above-fold',
    mask: 'outside',
    delta: 'loud',
    area: 'under-budget',
    motion: 'none',
  },
  {
    id: 'css-animation-phase',
    kind: 'noise',
    describes: 'the spinner and the fade-in are caught at a different phase',
    region: 'above-fold',
    mask: 'outside',
    delta: 'loud',
    area: 'over-budget',
    motion: 'css',
  },
  {
    id: 'script-animation-phase',
    kind: 'noise',
    describes: 'the progress bar, whose width a rAF callback writes, is further along',
    region: 'above-fold',
    mask: 'outside',
    delta: 'loud',
    area: 'over-budget',
    motion: 'script',
  },
]

export const CHANGE_IDS = CHANGES.map((entry) => entry.id)

export type ChangeId = (typeof CHANGE_IDS)[number]

export function change(id: string): Change {
  const found = CHANGES.find((candidate) => candidate.id === id)

  if (!found) {
    throw new Error(`no change named ${id}`)
  }

  return found
}

export const REGRESSIONS = CHANGES.filter((entry) => entry.kind === 'regression')
export const NOISE = CHANGES.filter((entry) => entry.kind === 'noise')
