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
 * **Shape: pyramid.** Measured at 57.6% unit / 40.0% integration / 2.4% e2e,
 * this suite orders unit > integration > e2e, which is the pyramid's claim.
 *
 * **Bands: wider than the textbook pyramid, on purpose.** Two reasons, and
 * both are properties of what this repository *is* rather than excuses:
 *
 *   1. It is a library of testing patterns, not an application. A meaningful
 *      share of its suite demonstrates boundary-crossing on purpose — MSW
 *      interception, supertest over a real socket, Pact against a mock
 *      provider, and now `containers/`, where a Postgres, a Redis and a Kafka
 *      broker are started so that what they leak between suites can be
 *      measured. An application with 30% integration tests might be
 *      over-invested at the seams; here it is the subject matter.
 *   2. Its audit suites read the repository off disk. `actionPins`,
 *      `gateSteps`, `patchedDeps`, `katas`, `taxonomy` and the
 *      characterisation corpus all open real files, which `boundaries.ts`
 *      classifies as integration on the classic Fowler line. That is one
 *      judgement call moving a large share of the middle band, and README.md
 *      says exactly what happens if you make it differently.
 *
 * The textbook pyramid's `integration: {max: 30}` does not merely pinch here —
 * this suite is outside it, at 40.0%. That is the honest finding rather than a
 * problem to be sized around, and it is why the middle band moved to 40% when
 * this policy was written.
 *
 * It has since moved again, to 45%, and that has a date on it: `containers/`
 * landed, a directory in which every test is a boundary test by subject
 * matter, and took the middle band to 40.0% against a ceiling of 40. Four more
 * integration tests would have failed the gate. A ceiling that close to the
 * measurement does not enforce a shape; it enforces a rewrite of itself on the
 * next honest commit.
 *
 * The end-to-end ceiling is deliberately *not* widened and stays on the
 * textbook 10%. What has changed is that it no longer binds anything: it was
 * set when the suite was 899 tests, where 12% was measured to let a doubled
 * Playwright suite through and 10% did not, and at 2,132 tests the same 51
 * declarations could triple and still be 6.8%. Every direction is now stopped
 * by the unit floor:
 *
 *   - integration may grow 852 → 954 (+12%); at 955 the middle band is still
 *     only 42.7% and unit has been diluted to 54.99%.
 *   - e2e may grow 51 → 153 (+200%); at 154 the e2e layer is 6.9% and unit is
 *     again 54.99%.
 *   - 125 unit tests may be deleted before the 55% floor fires.
 *
 * Those are checked in `policy.test.ts` at the edge — the last value that
 * passes and the first that does not — rather than left as prose. Every number
 * this comment has carried was wrong at least once, and the tests are what
 * found them: a 12% end-to-end ceiling turned out to permit a doubled
 * Playwright suite, the first integration figure was computed as if the bands
 * did not interact, and the e2e ceiling went on being described as the band
 * with the most to catch for two items after it had stopped catching anything.
 *
 * Re-tightening the e2e ceiling around today's 2.4% is a real decision and is
 * deliberately not taken here: Phase 10 of SPEC.md is a run of items that add
 * end-to-end tests, and drawing a band snugly the week before that is how a
 * band ends up being raised rather than read.
 */
export const POLICY: Policy = {
  shape: 'pyramid',
  bands: {
    unit: { min: 55, max: 80 },
    integration: { min: 15, max: 45 },
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
