// @vitest-environment node
//
// Compiles copies of `session.ts` and imports them off disk. Same reason as
// `detection.test.ts`.

import { beforeAll, describe, expect, it } from 'vitest'

import { BAND_DRAWS } from './probes.ts'
import { FAULT_IDS } from './faults.ts'
import {
  JITTER_SPAN_MS,
  MAX_REFRESH_DELAY_MS,
  MIN_REFRESH_DELAY_MS,
  REFRESH_FRACTION,
  TTL_MS,
} from './session.ts'
import {
  chanceOfSeeing,
  GRID_POINTS,
  grid,
  sensitivities,
  sensitivityOf,
  type Sensitivity,
} from './sensitivity.ts'

// The other half of the measurement. `detection.test.ts` asks whether a probe
// caught a fault; this asks how much of the input space the fault is even
// visible on, which is the number that says whether a "caught" was a
// technique working or a draw going the right way.

let measured: readonly Sensitivity[]

beforeAll(async () => {
  measured = await sensitivities()
}, 60_000)

const percent = (fault: (typeof FAULT_IDS)[number]): number =>
  Number((sensitivityOf(measured, fault).visibility * 100).toFixed(2))

describe('the draw grid', () => {
  it('samples ten thousand draws across the unit interval', () => {
    const draws = grid()

    expect(draws).toHaveLength(GRID_POINTS)
    expect(draws[0]).toBe(0)
    expect(draws.at(-1)).toBeCloseTo(1 - 1 / GRID_POINTS, 12)
  })

  // The single most consequential point in the space, because it is the only
  // draw a stubbed generator ever returns.
  it('includes the midpoint exactly', () => {
    expect(grid()).toContain(0.5)
  })

  // A grid can only see a fault wider than its spacing. The subject has two
  // thresholds and both are straddled, which is checked here rather than
  // assumed from "the grid is fine enough".
  it('straddles both clamp thresholds with adjacent samples', () => {
    const draws = grid()
    // Invert the jitter formula: uncorrected delay = base + (draw - 0.5) * SPAN,
    // so the draw at which the uncorrected delay hits a threshold is
    // (threshold - base) / SPAN + 0.5. Both clamp thresholds have to sit
    // between adjacent grid samples, or a fault only visible in a single grid
    // cell would be recorded as 0.0% invisibility.
    const base = TTL_MS * REFRESH_FRACTION
    const thresholds = [MIN_REFRESH_DELAY_MS, MAX_REFRESH_DELAY_MS].map(
      (delay) => (delay - base) / JITTER_SPAN_MS + 0.5,
    )

    for (const threshold of thresholds) {
      expect(draws.some((draw) => draw < threshold)).toBe(true)
      expect(draws.some((draw) => draw > threshold)).toBe(true)
    }
  })
})

describe('how much of the draw space each fault occupies', () => {
  it('measures one visibility per fault in the corpus', () => {
    expect(measured.map((entry) => entry.fault)).toEqual([...FAULT_IDS])
  })

  // Half the corpus does not live in `refreshDelayMs` at all, and that is the
  // quiet argument against "seed it and run it a lot" as a strategy: no number
  // of samples reaches a fault the draw does not influence.
  it('leaves nine faults untouched by any draw whatsoever', () => {
    const invisible = measured.filter((entry) => entry.invisibleToDelay).map((e) => e.fault)

    expect(invisible).toEqual([
      'TTL_IN_SECONDS',
      'EXPIRY_BOUNDARY_EXCLUSIVE',
      'EXPIRY_FROM_MONOTONIC_CLOCK',
      'RENEW_KEEPS_ORIGINAL_EXPIRY',
      'ELAPSED_FROM_WALL_CLOCK',
      'SCHEDULE_AT_ABSOLUTE_TIME',
      'SCHEDULE_DELAY_IN_SECONDS',
      'CANCEL_DOES_NOT_STOP_REFRESH',
      'ID_DERIVED_FROM_CLOCK',
    ])
  })

  it('measures the six randomness faults at the visibilities README.md quotes', () => {
    expect(percent('JITTER_SIGN_FLIPPED')).toBe(99.99)
    expect(percent('JITTER_RANGE_HALVED')).toBe(99.99)
    expect(percent('JITTER_ALWAYS_POSITIVE')).toBe(88.75)
    expect(percent('REFRESH_FRACTION_TOO_LATE')).toBe(88.75)
    expect(percent('JITTER_NOT_CLAMPED')).toBe(31.24)
    expect(percent('MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES')).toBe(10)
  })

  it('finds the sub-floor fault only once the lower clamp starts binding', () => {
    expect(sensitivityOf(measured, 'MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES').firstVisibleDraw).toBe(
      0.1,
    )
  })

  it('names the two faults a stubbed midpoint draw can see', () => {
    expect(measured.filter((entry) => entry.visibleAtMedian).map((entry) => entry.fault)).toEqual([
      'JITTER_ALWAYS_POSITIVE',
      'REFRESH_FRACTION_TOO_LATE',
    ])
  })

  // ---------------------------------------------------------------------
  // The result that reframes the whole comparison. The sign flip changes
  // the delay on 99.99% of the draw space and every random-draw world in
  // `detection.test.ts` still misses it. Being visible in the *input* space
  // is not the same as being asserted on: a test that draws randomly sees a
  // different number and has nothing to compare it against.
  // ---------------------------------------------------------------------
  it('leaves the most visible fault in the corpus unreachable by sampling', () => {
    const flip = sensitivityOf(measured, 'JITTER_SIGN_FLIPPED')

    expect(flip.visibility).toBeGreaterThan(0.999)
    expect(flip.visibleAtMedian).toBe(false)
  })
})

describe('what a visibility implies for a suite that samples', () => {
  it('reduces to certainty at zero and to nothing at no samples', () => {
    expect(chanceOfSeeing(0, 10_000)).toBe(0)
    expect(chanceOfSeeing(0.5, 0)).toBe(0)
    expect(chanceOfSeeing(1, 1)).toBe(1)
  })

  // A dozen draws is what a hand-written band check uses, and it is a coin
  // toss on the narrowest fault. This is the arithmetic behind `BAND_DRAWS`.
  it('leaves the narrowest fault at roughly even odds after a dozen draws', () => {
    const visibility = sensitivityOf(measured, 'MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES').visibility

    expect(chanceOfSeeing(visibility, 12)).toBeGreaterThan(0.7)
    expect(chanceOfSeeing(visibility, 12)).toBeLessThan(0.73)
    expect(chanceOfSeeing(visibility, 3)).toBeLessThan(0.28)
  })

  it('decides rather than samples the narrowest fault at the configured band size', () => {
    const visibility = sensitivityOf(measured, 'MIN_DELAY_CLAMP_ONLY_CATCHES_NEGATIVES').visibility

    expect(1 - chanceOfSeeing(visibility, BAND_DRAWS)).toBeLessThan(1e-12)
  })

  it('grows with the sample count and never exceeds certainty', () => {
    const visibility = 0.1

    for (const samples of [1, 2, 8, 64, 512]) {
      expect(chanceOfSeeing(visibility, samples)).toBeLessThanOrEqual(1)
    }

    expect(chanceOfSeeing(visibility, 8)).toBeGreaterThan(chanceOfSeeing(visibility, 4))
  })
})
