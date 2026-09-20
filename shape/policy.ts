/**
 * The ratio policy: which shape this repository claims to be, and how far it
 * may drift before CI says otherwise.
 *
 * ---------------------------------------------------------------------------
 * Two shapes, one axis
 * ---------------------------------------------------------------------------
 * The pyramid and the honeycomb disagree about one thing, and it is not really
 * the percentages. They disagree about *where the cheapest useful test lives*.
 *
 * The pyramid assumes the unit is where behaviour is decided, so most of the
 * value is reachable without crossing anything. The honeycomb assumes the
 * opposite — that in a service whose job is to talk to a database, a queue and
 * three other services, the interesting behaviour only exists at the seams, and
 * a unit test of a class that mostly delegates is testing the delegation.
 *
 * That makes the shapes comparable on one axis, which is what `boundaries.ts`
 * measures: how wide a boundary does a test reach. And it makes the *ordering*
 * of the layers, not the exact percentages, the real claim. A pyramid says
 * unit > integration > e2e. A honeycomb says integration > unit and
 * integration > e2e. Everything else is tolerance.
 *
 * So `evaluate` checks both, separately, and reports them differently: an
 * ordering violation means the suite has changed shape, a band violation means
 * it has drifted within its shape. Only the first is a statement about design.
 *
 * ---------------------------------------------------------------------------
 * Bands are not derived from the measurement
 * ---------------------------------------------------------------------------
 * A band drawn snugly around today's number enforces nothing — it is a
 * screenshot with a CI job attached, and it goes red on the next honest commit
 * rather than on the wrong one. The bands below are picked to be *loose enough
 * to be stable and tight enough to catch the failure they exist for*, and
 * `README.md` states the headroom each one leaves in tests, so the teeth are
 * visible rather than asserted.
 */

import { LAYERS, type Layer } from './boundaries.ts'

/** An inclusive percentage range for one layer's share of the suite. */
export interface Band {
  readonly min: number
  readonly max: number
}

/** A named suite shape, as the literature states it. */
export interface ShapeDefinition {
  readonly name: string
  /** Where the shape comes from, so the reader can go and disagree with it. */
  readonly origin: string
  /** The one-sentence claim, in the shape's own terms. */
  readonly claim: string
  /**
   * Layers whose shares must strictly decrease, widest share first.
   *
   * This is the shape's actual assertion. The pyramid orders all three; the
   * honeycomb only claims integration is the largest and says nothing about
   * whether unit or e2e comes second, so it orders integration against each of
   * the others rather than ranking those two.
   */
  readonly ordering: readonly (readonly [Layer, Layer])[]
  /** Textbook bands, for comparison. Not what CI enforces — see {@link POLICY}. */
  readonly bands: Readonly<Record<Layer, Band>>
  readonly rationale: string
}

/**
 * The two shapes this repository documents.
 *
 * The bands are the ones usually quoted for each: 70/20/10 for the pyramid,
 * and for the honeycomb a small implementation-detail layer, a dominant
 * integration layer and a thin integrated one. They are round numbers from
 * blog posts and conference talks rather than measurements, which is precisely
 * why they are kept separate from the policy CI enforces.
 */
export const SHAPES = {
  pyramid: {
    name: 'Test pyramid',
    origin: 'Mike Cohn, Succeeding with Agile (2009); popularised by Martin Fowler (2012)',
    claim: 'Most tests should be unit tests; each wider layer should be smaller than the one below it.',
    ordering: [
      ['unit', 'integration'],
      ['integration', 'e2e'],
    ],
    bands: {
      unit: { min: 60, max: 85 },
      integration: { min: 10, max: 30 },
      e2e: { min: 1, max: 10 },
    },
    rationale:
      'Wide tests cost more per unit of confidence: they are slower, they fail for ' +
      'reasons that are not the defect, and they localise badly. If a behaviour can ' +
      'be decided without crossing a boundary, deciding it there is cheaper for the ' +
      'life of the code.',
  },
  honeycomb: {
    name: 'Testing honeycomb',
    origin: 'Spotify Engineering, "Testing of Microservices" (2018)',
    claim:
      'Integration tests should dominate; unit tests of implementation details and ' +
      'full integrated tests are both thin.',
    ordering: [
      ['integration', 'unit'],
      ['integration', 'e2e'],
    ],
    bands: {
      unit: { min: 5, max: 30 },
      integration: { min: 50, max: 80 },
      e2e: { min: 2, max: 15 },
    },
    rationale:
      'In a service that mostly moves data between a transport, a store and other ' +
      'services, the behaviour worth asserting only exists once those are connected. ' +
      'A unit test of a class that delegates asserts the delegation, which is the ' +
      'part refactoring changes and the part users never see.',
  },
} as const satisfies Record<string, ShapeDefinition>

export type ShapeName = keyof typeof SHAPES

/** The policy CI enforces. */
export interface Policy {
  readonly shape: ShapeName
  /** What is actually enforced. Deliberately wider than the textbook bands. */
  readonly bands: Readonly<Record<Layer, Band>>
  readonly why: string
}

/**
 * This repository's declared policy.
 *
 * **Shape: pyramid.** Measured at 54.3% unit / 43.7% integration / 2.1% e2e,
 * this suite orders unit > integration > e2e, which is the pyramid's claim.
 *
 * **Bands: much wider than the textbook pyramid, because the suite grows in one
 * direction.** Two reasons, and both are properties of what this repository
 * *is* rather than excuses:
 *
 *   1. It is a library of testing patterns, not an application. A meaningful
 *      share of its suite demonstrates boundary-crossing on purpose — MSW
 *      interception, supertest over a real socket, Pact against a mock
 *      provider, `containers/`, where three servers are started so that what
 *      they leak between suites can be measured, and `dbisolation/`, where a
 *      Postgres-backed service is run under seven isolation strategies. An
 *      application with 30% integration tests might be over-invested at the
 *      seams; here it is the subject matter.
 *   2. Its audit suites read the repository off disk. `actionPins`,
 *      `gateSteps`, `patchedDeps`, `katas`, `taxonomy`, the characterisation
 *      corpus and three README audits all open real files, which
 *      `boundaries.ts` classifies as integration on the classic Fowler line.
 *      That is one judgement call moving a large share of the middle band, and
 *      README.md says exactly what happens if you make it differently.
 *
 * ---------------------------------------------------------------------------
 * Why the bands were re-drawn a third time, and differently
 * ---------------------------------------------------------------------------
 * The middle ceiling went 30% (textbook) → 40% → 45%, each time because one
 * item had pushed the measurement into the old band. That is the pattern this
 * file's own rule warns about: a band moved to clear today's number is a
 * screenshot with a CI job attached, and it is moved again next time.
 *
 * `dbisolation/` is the item where the reason became visible. It is not that
 * the middle band is slightly too tight; it is that **this repository grows by
 * adding one boundary-measurement directory per SPEC item**, so integration
 * grows on almost every commit and unit does not. Against that, a floor one
 * point above the measurement does not enforce a shape — it schedules its own
 * next edit. The floor had 1.0 point of headroom, the ceiling 1.3, and the e2e
 * floor 0.1, all three against a suite that adds integration tests by design.
 *
 * So the bands are drawn for that growth rather than around the measurement:
 * unit 50%, integration 48%, e2e 1%. They are loose, and what makes that
 * acceptable is that they were never the real claim. The *ordering* is — a
 * pyramid says unit > integration > e2e, `evaluate` checks it separately, and
 * it reverses 263 integration tests from here, which is roughly two more
 * directories the size of this one.
 *
 * 48% rather than a rounder 55% is not a preference. Under a 50% unit floor the
 * ordering already forbids integration from exceeding unit, so integration can
 * never reach 50% with the pyramid intact: any ceiling at or above 50% is
 * decorative, unreachable except by a suite that has failed the ordering check
 * first. `policy.test.ts` is what said so — its "integration above its ceiling
 * while the ordering still holds" case became unsatisfiable at 55% and refused
 * to pass, which is a band gate catching an edit to the bands.
 *
 * That is the thing to watch, and it is a decision rather than a band: when the
 * ordering does reverse, the honest move is to declare the honeycomb — which
 * this file already documents, and whose claim ("in a service that mostly moves
 * data between a transport, a store and other services, the behaviour worth
 * asserting only exists once those are connected") describes a pattern library
 * about integration testing rather well. Widening the bands a fourth time would
 * not be the honest move. This comment exists so that the next person to reach
 * this line is choosing rather than adjusting.
 *
 * The end-to-end **floor** moved 2% → 1% for a reason that is not about e2e at
 * all: the Playwright suite was a fixed 51 declarations when the floor was
 * drawn, so its *share* fell whenever anything else was added, and at 2,484
 * tests it sat at 2.1%. A floor that fires because a Postgres suite was added
 * elsewhere is not reporting anything about end-to-end coverage. At 1% it still
 * catches the failure it is for — somebody deleting the e2e suite — and Phase
 * 10 of `SPEC.md` is a run of items that add end-to-end tests and restore the
 * headroom. The component suite in `ct/` is the first, at 13 declarations, and
 * the interception matrix in `intercept/` is the second, at 29 — which is what
 * took the layer from 2.2% to 3.0% without moving a band.
 *
 * The figures in the headroom arithmetic below are the ones measured then, and
 * they are scenarios rather than a snapshot to keep current: `policy.test.ts`
 * checks them at the edge as written-down numbers, which is what makes them
 * still mean something after the suite has moved.
 *
 * The end-to-end **ceiling** stays on the textbook 10% and still binds nothing.
 * What has changed is that the unit floor is no longer the only band doing
 * work: at 48% the middle ceiling stops integration growth before dilution
 * does. Holding the other layers still, from 1,348 / 1,085 / 51:
 *
 *   - integration may grow 1,085 → 1,291 (+19%); at 1,292 the middle layer is
 *     48.0% and it is its own ceiling that fires, not the unit floor.
 *   - e2e may grow 51 → 263 (+416%); at 264 unit is 49.99% and e2e is 9.8%,
 *     nowhere near its 10% ceiling.
 *   - 212 unit tests may be deleted before the 50% floor fires.
 *
 * Those are checked in `policy.test.ts` at the edge — the last value that
 * passes and the first that does not — rather than left as prose. Every number
 * this comment has carried was wrong at least once, and the tests are what
 * found them.
 */
export const POLICY: Policy = {
  shape: 'pyramid',
  bands: {
    unit: { min: 50, max: 80 },
    integration: { min: 15, max: 48 },
    e2e: { min: 1, max: 10 },
  },
  why:
    'A pattern library that demonstrates boundary-crossing, audits itself by ' +
    'reading its own files, and gains a boundary-measurement directory per SPEC ' +
    'item carries a legitimately fatter middle band than the application the ' +
    'pyramid was drawn for — and needs bands drawn for that growth rather than ' +
    'around this week\'s measurement. The ordering is the claim; the bands are ' +
    'tolerance.',
}

/** Test counts per layer, and what share of the suite each one is. */
export interface Measurement {
  readonly counts: Readonly<Record<Layer, number>>
  readonly total: number
  /** Percentage of the suite, unrounded. */
  readonly share: Readonly<Record<Layer, number>>
}

/** A way the suite fails its policy. */
export type Violation =
  | {
      readonly kind: 'band'
      readonly layer: Layer
      readonly share: number
      readonly band: Band
      readonly detail: string
    }
  | {
      readonly kind: 'ordering'
      readonly wider: Layer
      readonly narrower: Layer
      readonly detail: string
    }
  | { readonly kind: 'empty'; readonly detail: string }

/** Turn per-layer counts into shares. */
export function measure(counts: Readonly<Record<Layer, number>>): Measurement {
  const total = LAYERS.reduce((sum, layer) => sum + counts[layer], 0)
  const share = Object.fromEntries(
    LAYERS.map((layer) => [layer, total === 0 ? 0 : (counts[layer] / total) * 100]),
  ) as Record<Layer, number>

  return { counts, total, share }
}

/** One decimal place, for messages. Comparisons always use the raw share. */
export const percent = (share: number): string => `${share.toFixed(1)}%`

/**
 * Check a measurement against a policy.
 *
 * Ordering is checked on raw counts rather than shares — they are the same
 * comparison, but counts are what a reader can verify against the report
 * without doing arithmetic. Bands are checked on the unrounded share, so a
 * layer at 40.04% fails a `max: 40` band rather than rounding into it.
 */
export function evaluate(measurement: Measurement, policy: Policy = POLICY): Violation[] {
  if (measurement.total === 0) {
    return [
      {
        kind: 'empty',
        detail: 'No tests were collected at all, so no ratio can be computed.',
      },
    ]
  }

  const violations: Violation[] = []
  const shape = SHAPES[policy.shape]

  for (const [wider, narrower] of shape.ordering) {
    if (measurement.counts[wider] <= measurement.counts[narrower]) {
      violations.push({
        kind: 'ordering',
        wider,
        narrower,
        detail:
          `${shape.name} requires more ${wider} tests than ${narrower} tests, but there ` +
          `are ${measurement.counts[wider]} ${wider} and ${measurement.counts[narrower]} ` +
          `${narrower}. The suite has changed shape, not merely drifted.`,
      })
    }
  }

  for (const layer of LAYERS) {
    const band = policy.bands[layer]
    const share = measurement.share[layer]

    if (share < band.min) {
      violations.push({
        kind: 'band',
        layer,
        share,
        band,
        detail:
          `${layer} is ${percent(share)} of the suite, below the ${band.min}% floor ` +
          `(${measurement.counts[layer]} of ${measurement.total} tests).`,
      })
    } else if (share > band.max) {
      violations.push({
        kind: 'band',
        layer,
        share,
        band,
        detail:
          `${layer} is ${percent(share)} of the suite, above the ${band.max}% ceiling ` +
          `(${measurement.counts[layer]} of ${measurement.total} tests).`,
      })
    }
  }

  return violations
}
