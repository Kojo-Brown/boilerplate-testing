/**
 * The declared result: which probe goes red against which variant.
 *
 * Written down here and re-derived by `detection.test.ts` from an actual run
 * of the three probes against sixteen compiled variants. Edit a probe to look
 * better and the table stops agreeing; edit the table and the run stops
 * agreeing with it. The README's numbers are computed from this file by
 * `readme.test.ts`, so all three cannot drift apart.
 */

import { BUGS, VARIANTS, type VariantId } from './edits.ts'
import { PROBE_IDS, type ProbeId } from './probes.ts'

export const DETECTION: Readonly<Record<VariantId, readonly ProbeId[]>> = {
  // ---- bugs -------------------------------------------------------------
  // Arithmetic in a corner of the corpus nobody wrote an assertion for. The
  // discount error only moves ORD-1043's discount and total; the truncation
  // only bites on ORD-1045, where the tax is £0.998 and rounding decides the
  // penny. Both snapshot probes see them for free, because a snapshot asserts
  // on the values a person did not think to name.
  DISCOUNT_INCLUDES_DELIVERY: ['full', 'projected'],
  TAX_TRUNCATED: ['full', 'projected'],

  MINOR_UNITS_UNPADDED: ['full', 'projected', 'assertions'],
  PLURAL_INVERTED: ['full', 'projected', 'assertions'],
  CANCELLED_LABEL_CHANGED: ['full', 'projected', 'assertions'],
  CUSTOMER_NAME_UNESCAPED: ['full', 'projected', 'assertions'],
  NEGATIVE_SIGN_DROPPED: ['full', 'projected', 'assertions'],
  LINE_TOTAL_IGNORES_QUANTITY: ['full', 'projected', 'assertions'],

  // The projection's blind spots, and the reason the recommendation is not
  // "snapshot a projection and stop there". Neither change moves a published
  // value: the badge still says "Cancelled", the region still contains
  // everything it did. What is gone is the class that colours it and the name
  // a screen reader announces.
  BADGE_MODIFIER_DROPPED: ['full', 'assertions'],
  ARIA_LABEL_DROPPED: ['full', 'assertions'],

  // ---- noise ------------------------------------------------------------
  // Six refactors that changed nothing a reader or a screen reader can
  // perceive. The full snapshot fails on every one of them. This column is the
  // rubber-stamping mechanism, and it is the whole reason the headline number
  // below is a signal rate rather than a detection rate.
  WRAPPER_DIV_ADDED: ['full'],
  HEADER_CLASS_RENAMED: ['full'],
  BOLD_TAG_MODERNISED: ['full'],
  TEST_ID_ADDED: ['full'],
  ITEM_ROWS_REINDENTED: ['full'],
  BADGE_ATTRIBUTES_REORDERED: ['full'],
}

/** Variants a probe goes red against. */
export function redFor(probe: ProbeId): VariantId[] {
  return VARIANTS.filter((variant) => DETECTION[variant.id].includes(probe)).map(
    (variant) => variant.id,
  )
}

export interface ProbeResult {
  readonly probe: ProbeId
  /** Bugs caught, of ten. */
  readonly caught: number
  /** Refactors this probe also failed on, of six. */
  readonly falseAlarms: number
  /**
   * Of every time this probe goes red, the fraction that is a real defect.
   *
   * The number a reviewer's habit forms around. A probe that is right 100% of
   * the time is one whose red is worth reading; a probe that is right 62% of
   * the time is one where `-u` is a defensible first response, and the
   * technique's real failure mode follows from there.
   */
  readonly signalRate: number
}

const rate = (caught: number, alarms: number): number =>
  caught + alarms === 0 ? 0 : (caught / (caught + alarms)) * 100

export function resultFor(probe: ProbeId): ProbeResult {
  const red = redFor(probe)
  const caught = red.filter((id) => BUGS.some((bug) => bug.id === id)).length

  return {
    probe,
    caught,
    falseAlarms: red.length - caught,
    signalRate: rate(caught, red.length - caught),
  }
}

export const RESULTS: readonly ProbeResult[] = PROBE_IDS.map(resultFor)

/**
 * The recommended pairing: a projected snapshot plus explicit assertions.
 *
 * Computed rather than asserted, because the interesting part is that neither
 * component dominates the other — they miss different things — and a union
 * that turned out to leave a bug uncaught would say the recommendation is
 * wrong.
 */
export function unionResult(probes: readonly ProbeId[]): ProbeResult {
  const red = new Set(probes.flatMap((probe) => redFor(probe)))
  const caught = [...red].filter((id) => BUGS.some((bug) => bug.id === id)).length

  return {
    probe: 'projected',
    caught,
    falseAlarms: red.size - caught,
    signalRate: rate(caught, red.size - caught),
  }
}
