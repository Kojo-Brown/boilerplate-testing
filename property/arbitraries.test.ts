/**
 * The arbitraries, measured.
 *
 * Everything `arbitraries.ts` claims about what it generates is a number, and
 * every number is recomputed here from a fixed seed rather than quoted. That
 * matters more than it sounds: an arbitrary is the only part of a property
 * suite whose degradation is completely silent. Narrow `wideInterval`'s bounds
 * by accident and nothing fails — the properties still pass, the report still
 * says two hundred runs, and the suite is testing a fraction of what it was.
 * These assertions are what make that a red build.
 *
 * The bounds are set to catch a real change and not to fence today's number in
 * at one decimal place: `touch` under the clustered arbitrary is asserted above
 * 30%, measured at 49.4%. A band drawn snugly around a measurement is a
 * screenshot with a CI job attached.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  boundedInterval,
  boundedScenario,
  clusteredScenario,
  DEGENERATE_FREE_SAMPLES,
  GRID_CELLS,
  isSortedDisjoint,
  MAX_SET_SIZE,
  naiveDisjointSetDraw,
  naiveInterval,
  naiveIntervalDraw,
  SAMPLE_IDS,
  SAMPLES,
  sampleNamed,
  wideInterval,
} from './arbitraries'
import { NUM_RUNS, SEED } from './config'
import { DOMAIN } from './model'
import { percent, PROFILE_DRAWS, profileSample } from './profile'

const draw = <T,>(arbitrary: fc.Arbitrary<T>, count: number): T[] =>
  fc.sample(arbitrary, { seed: SEED, numRuns: count })

describe('building values instead of filtering them', () => {
  it('produces a valid range every time, so nothing is discarded', () => {
    for (const candidate of draw(boundedInterval, PROFILE_DRAWS)) {
      expect(candidate.end).toBeGreaterThan(candidate.start)
    }
  })

  it('stays inside the domain the point-set model can enumerate', () => {
    for (const candidate of draw(boundedInterval, PROFILE_DRAWS)) {
      expect(candidate.start).toBeGreaterThanOrEqual(0)
      expect(candidate.end).toBeLessThanOrEqual(DOMAIN)
    }
  })

  it('throws away most of a naive draw: 464 of 1,000 are usable', () => {
    // The arithmetic behind "build, don't filter". Two independent coordinates
    // are in the right order slightly under half the time — and the ones that
    // are equal are discarded too, which is where the missing 3.6 points go.
    const usable = draw(naiveIntervalDraw, PROFILE_DRAWS).filter(
      (candidate) => candidate.end > candidate.start,
    )

    expect(usable).toHaveLength(464)
  })

  it('throws away all but 1 in 1,000 once the constraint is a sorted disjoint set', () => {
    // One more constraint, three orders of magnitude. This is why rejection
    // sampling stops being an option rather than becoming slightly slower.
    const usable = draw(naiveDisjointSetDraw, PROFILE_DRAWS).filter(isSortedDisjoint)

    expect(usable).toHaveLength(1)
  })

  it('still yields only valid ranges once the filter is applied', () => {
    for (const candidate of draw(naiveInterval, 200)) {
      expect(candidate.end).toBeGreaterThan(candidate.start)
    }
  })

  it('fails outright when the same constraint is written as a precondition', () => {
    // `.filter` absorbs a 0.1% yield by drawing about a thousand times per
    // value — slow, and silent. `fc.pre` refuses instead, which is the better
    // failure: fast-check reports how many runs it managed against how many it
    // skipped, so the diagnosis is in the error rather than in a profiler.
    expect(() => {
      fc.assert(
        fc.property(naiveDisjointSetDraw, (set) => {
          fc.pre(isSortedDisjoint(set))

          return true
        }),
        { seed: SEED, numRuns: NUM_RUNS },
      )
    }).toThrow('too many pre-condition failures')
  })
})

describe('what each arbitrary actually generates', () => {
  const profiles = new Map(SAMPLES.map((sample) => [sample.id, profileSample(sample)]))

  const share = (id: (typeof SAMPLE_IDS)[number], situation: 'overlap' | 'touch' | 'degenerate'): number => {
    const profile = profiles.get(id)

    if (profile === undefined) {
      throw new Error(`no profile for ${id}`)
    }

    return (profile.counts[situation] / profile.draws) * 100
  }

  it('collides constantly under the bounded arbitrary, which is what exercises merging', () => {
    expect(share('bounded', 'overlap')).toBeGreaterThan(60)
    expect(share('bounded', 'touch')).toBeGreaterThan(20)
  })

  it('almost never collides under the sparse arbitrary, though every value is legal', () => {
    // The uninformative arbitrary. Nothing about it is wrong, and it exercises
    // the merging branch in one scenario in forty.
    expect(share('sparse', 'overlap')).toBeLessThan(10)
    expect(share('sparse', 'touch')).toBeLessThan(2)
  })

  it('never places two endpoints together under the wide arbitrary', () => {
    // Two independently drawn doubles are never equal, so the half-open
    // touching case — the one `TOUCHING_NOT_MERGED` lives in — cannot occur.
    expect(share('wide', 'touch')).toBe(0)
  })

  it('collides more under the wide arbitrary than the bounded one, not less', () => {
    // Worth stating because it contradicts the obvious guess. `fc.double`
    // draws across the bit-pattern space, so a ±1,000,000 range is crowded
    // with denormals and tiny magnitudes near zero rather than spread evenly.
    expect(share('wide', 'overlap')).toBeGreaterThan(share('bounded', 'overlap'))
  })

  it('places endpoints together under the clustered arbitrary, because they share a grid', () => {
    expect(share('clustered', 'touch')).toBeGreaterThan(30)
    expect(share('clustered', 'overlap')).toBeGreaterThan(60)
  })

  it('generates a zero-length range only where one was asked for', () => {
    // The cost of "always valid" made visible: three arbitraries that cannot
    // produce a degenerate range, and one that was written to.
    for (const id of DEGENERATE_FREE_SAMPLES) {
      expect(share(id, 'degenerate'), `${id} generated a degenerate range`).toBe(0)
    }

    expect(share('clustered', 'degenerate')).toBeGreaterThan(20)
  })

  it('reaches negative and fractional coordinates only outside the integer domains', () => {
    for (const id of ['bounded', 'sparse'] as const) {
      const profile = profiles.get(id)

      expect(profile?.counts.negative, `${id} generated a negative coordinate`).toBe(0)
      expect(profile?.counts.fractional, `${id} generated a fractional coordinate`).toBe(0)
    }

    for (const id of ['wide', 'clustered'] as const) {
      const profile = profiles.get(id)

      expect(profile?.counts.fractional ?? 0).toBeGreaterThan(PROFILE_DRAWS / 2)
      expect(profile?.counts.negative ?? 0).toBeGreaterThan(0)
    }
  })

  it('renders a share the way the README prints it', () => {
    expect(percent(494, 1000)).toBe('49.4%')
    expect(percent(0, 1000)).toBe('0.0%')
  })
})

describe('the clustered arbitrary’s shared context', () => {
  it('lays every range in one scenario on the same grid', () => {
    // The technique the module is demonstrating: one draw for the origin and
    // the spacing, distributed over the whole scenario by `map`. Two endpoints
    // computed as `origin + k * unit` for the same `k` are the same double,
    // which is the only way floating-point ranges ever touch exactly.
    for (const scenario of draw(clusteredScenario, 200)) {
      const coordinates = [...scenario.a, ...scenario.b].flatMap((range) => [
        range.start,
        range.end,
      ])

      if (coordinates.length < 2) {
        continue
      }

      const spread = Math.max(...coordinates) - Math.min(...coordinates)

      // Every cell offset is at most GRID_CELLS + 8 cells from the origin, and
      // a cell is at most 4 wide.
      expect(spread).toBeLessThanOrEqual((GRID_CELLS + 8) * 4)
    }
  })

  it('keeps every scenario within the declared set size', () => {
    for (const sample of SAMPLES) {
      for (const scenario of draw(sample.scenario, 100)) {
        expect(scenario.a.length).toBeLessThanOrEqual(MAX_SET_SIZE)
        expect(scenario.b.length).toBeLessThanOrEqual(MAX_SET_SIZE)
      }
    }
  })
})

describe('determinism', () => {
  it('draws the same values twice from the same seed', () => {
    // The claim `config.ts` rests on. Without it, every measurement in this
    // directory would be a different number on the next run and the README
    // would be fiction.
    expect(draw(clusteredScenario, 50)).toEqual(draw(clusteredScenario, 50))
  })

  it('draws different values from a different seed', () => {
    const here = fc.sample(boundedScenario, { seed: SEED, numRuns: 50 })
    const elsewhere = fc.sample(boundedScenario, { seed: SEED + 1, numRuns: 50 })

    expect(here).not.toEqual(elsewhere)
  })

  it('produces a range whose end exceeds its start even at the widest magnitudes', () => {
    // `wideInterval`'s length floor of 0.5 exists for this: at |start| ≤ 1e6 a
    // double's spacing is about 1.2e-10, so the addition cannot round away.
    for (const candidate of draw(wideInterval, PROFILE_DRAWS)) {
      expect(candidate.end).toBeGreaterThan(candidate.start)
    }
  })
})

describe('the sample catalogue', () => {
  it('gives every arbitrary a label the README can print', () => {
    for (const sample of SAMPLES) {
      expect(sample.label.length, `${sample.id} has no label`).toBeGreaterThan(10)
    }
  })

  it('lists exactly the arbitraries the ids declare', () => {
    expect(SAMPLES.map((sample) => sample.id)).toEqual([...SAMPLE_IDS])
  })

  it('finds an arbitrary by id', () => {
    expect(sampleNamed('sparse').id).toBe('sparse')
  })
})
