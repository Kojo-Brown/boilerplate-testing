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
 * **Shape: pyramid.** Measured at 61.5% unit / 32.8% integration / 5.7% e2e,
 * this suite orders unit > integration > e2e, which is the pyramid's claim.
 *
 * **Bands: wider than the textbook pyramid, on purpose.** Two reasons, and
 * both are properties of what this repository *is* rather than excuses:
 *
 *   1. It is a library of testing patterns, not an application. A meaningful
 *      share of its suite demonstrates boundary-crossing on purpose — MSW
 *      interception, supertest over a real socket, Pact against a mock
 *      provider. An application with 30% integration tests might be
 *      over-invested at the seams; here it is the subject matter.
 *   2. Its audit suites read the repository off disk. `actionPins`,
 *      `gateSteps`, `patchedDeps`, `katas`, `taxonomy` and the
 *      characterisation corpus all open real files, which `boundaries.ts`
 *      classifies as integration on the classic Fowler line. That is one
 *      judgement call moving ~29% of the middle band, and README.md says
 *      exactly what happens if you make it differently.
 *
 * The textbook pyramid's `integration: {max: 30}` does not merely pinch here —
 * this suite is outside it, at 32.8%. That is the honest finding rather than a
 * problem to be sized around: for the two reasons above, this repository's
 * middle band is legitimately fatter than the one the pyramid was drawn for. So
 * the middle band is the one that moves, from 10–30% to 15–40%.
 *
 * The end-to-end ceiling is deliberately *not* widened, and stays on the
 * textbook 10%. It is the band with the most to catch — end-to-end tests are
 * where a suite gets slow and flaky — and widening it to 12% was tried first
 * and abandoned: at 12% a doubled Playwright suite still passed, which makes
 * the ceiling decorative. The measured headroom at 10%, holding the other
 * layers still, is:
 *
 *   - e2e may grow 51 → 94 tests (+84%) before the ceiling fires; a doubling
 *     to 102 gives 10.7% and fails.
 *   - integration may grow 295 → 401 (+36%). Note that the band which stops it
 *     is the *unit floor*, not the integration ceiling: adding integration
 *     tests dilutes every other layer's share, so 55% unit binds at 401 while
 *     40% integration would not bind until 402. Bands interact, and only the
 *     tightest one is ever the real limit.
 *   - 130 unit tests may be deleted before the 55% floor fires.
 *
 * Those are checked in `policy.test.ts` at the edge — the last value that
 * passes and the first that does not — rather than left as prose. Both of the
 * numbers this comment first carried were wrong, and the tests are what found
 * them: a 12% end-to-end ceiling turned out to permit a doubled Playwright
 * suite, and the integration figure was computed as if the bands did not
 * interact.
 */
export const POLICY: Policy = {
  shape: 'pyramid',
  bands: {
    unit: { min: 55, max: 80 },
    integration: { min: 15, max: 40 },
    e2e: { min: 2, max: 10 },
  },
  why:
    'A pattern library that demonstrates boundary-crossing, and audits itself by ' +
    'reading its own files, carries a legitimately fatter middle band than the ' +
    'application the pyramid was drawn for.',
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
