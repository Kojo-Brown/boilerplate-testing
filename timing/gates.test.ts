// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { baselineFrom, type Baseline } from './baseline.ts'
import {
  FILE_DELTA_MS,
  FILE_FLOOR_MS,
  FILE_TOLERANCE,
  GATE_IDS,
  GATES,
  TOTAL_TOLERANCE,
  fires,
  gate,
} from './gates.ts'

/**
 * A baseline with one file of each interesting size.
 *
 * Hand-built rather than taken from the corpus: these tests are about where
 * each rule's boundary is, and a boundary is easiest to read against round
 * numbers.
 */
const baseline: Baseline = baselineFrom([
  { 'tiny.test.ts': 2, 'mid.test.ts': 40, 'big.test.ts': 400 },
])

describe('the gate catalogue', () => {
  it('declares one entry per id, in the same order', () => {
    expect(GATES.map((entry) => entry.id)).toEqual([...GATE_IDS])
  })

  it('answers each id with its entry', () => {
    for (const id of GATE_IDS) {
      expect(gate(id).id).toBe(id)
    }
  })

  it('refuses an id it does not know', () => {
    // @ts-expect-error -- the guard exists for callers without types.
    expect(() => gate('nope')).toThrow(/unknown gate/)
  })

  it('gives every entry a rule and a note that says where it comes from', () => {
    for (const entry of GATES) {
      expect(entry.rule).not.toBe('')
      expect(entry.note.length).toBeGreaterThan(40)
    }
  })

  it('quotes its own thresholds in the rules rather than restating them', () => {
    expect(gate('file-percent').rule).toContain('25.0%')
    expect(gate('file-absolute').rule).toContain('25ms')
    expect(gate('file-percent-floored').rule).toContain('25ms')
    expect(gate('total-percent').rule).toContain('3.0%')
  })
})

describe('the thresholds', () => {
  // Pinned so that moving one fails here rather than silently restating the
  // published matrix. They were chosen before the matrix was computed.
  it('holds the round numbers the matrix was scored with', () => {
    expect(FILE_TOLERANCE).toBe(0.25)
    expect(FILE_DELTA_MS).toBe(25)
    expect(FILE_FLOOR_MS).toBe(25)
    expect(TOTAL_TOLERANCE).toBe(0.03)
  })
})

describe('none', () => {
  it('stays quiet on a run that is twice the baseline everywhere', () => {
    expect(fires('none', baseline, { 'tiny.test.ts': 4, 'mid.test.ts': 80, 'big.test.ts': 800 })).toBe(
      false,
    )
  })
})

describe('file-percent', () => {
  it('fires on a file a quarter over its baseline', () => {
    expect(fires('file-percent', baseline, { ...flat(), 'mid.test.ts': 51 })).toBe(true)
  })

  it('stays quiet at exactly the tolerance, which is not "more than"', () => {
    expect(fires('file-percent', baseline, { ...flat(), 'mid.test.ts': 50 })).toBe(false)
  })

  // The design's whole problem, as a unit test: half a millisecond on the 2ms
  // file is a 25% regression and is indistinguishable from the scheduler.
  it('fires on the shortest file for a change of under a millisecond', () => {
    expect(fires('file-percent', baseline, { ...flat(), 'tiny.test.ts': 2.6 })).toBe(true)
  })
})

describe('file-percent-floored', () => {
  it('ignores a file whose baseline is below the floor, however far it moved', () => {
    expect(fires('file-percent-floored', baseline, { ...flat(), 'tiny.test.ts': 200 })).toBe(false)
  })

  it('fires on a file at or above the floor that is over its tolerance', () => {
    expect(fires('file-percent-floored', baseline, { ...flat(), 'mid.test.ts': 51 })).toBe(true)
  })
})

describe('file-absolute', () => {
  it('fires on a file more than the delta over its baseline', () => {
    expect(fires('file-absolute', baseline, { ...flat(), 'mid.test.ts': 66 })).toBe(true)
  })

  it('stays quiet on a file that tripled but cost only four milliseconds', () => {
    expect(fires('file-absolute', baseline, { ...flat(), 'tiny.test.ts': 6 })).toBe(false)
  })

  // The complement of the finding above: a tenth of a large file is real wall
  // clock and no percentage rule set for small files will see it.
  it('fires on a tenth added to the largest file', () => {
    expect(fires('file-absolute', baseline, { ...flat(), 'big.test.ts': 440 })).toBe(true)
  })
})

describe('file-both', () => {
  it('fires only when a file is over by the percentage and the delta together', () => {
    // 25% over but only 10ms: under the delta.
    expect(fires('file-both', baseline, { ...flat(), 'mid.test.ts': 51 })).toBe(false)
    // 40ms over but only 10%: under the percentage.
    expect(fires('file-both', baseline, { ...flat(), 'big.test.ts': 440 })).toBe(false)
    // Both.
    expect(fires('file-both', baseline, { ...flat(), 'mid.test.ts': 90 })).toBe(true)
  })
})

describe('total-percent', () => {
  it('fires when the suite total is over its tolerance', () => {
    expect(fires('total-percent', baseline, scaled(1.04))).toBe(true)
  })

  it('stays quiet when the total is within tolerance, however it is distributed', () => {
    expect(fires('total-percent', baseline, scaled(1.02))).toBe(false)
  })

  it('stays quiet on a file that doubled but is too small to move the total', () => {
    expect(fires('total-percent', baseline, { ...flat(), 'tiny.test.ts': 4 })).toBe(false)
  })
})

describe('recommended', () => {
  it('stays quiet on a run that matches its baseline', () => {
    expect(fires('recommended', baseline, flat())).toBe(false)
  })

  it('fires on a localised regression the total would dilute', () => {
    expect(fires('recommended', baseline, { ...flat(), 'mid.test.ts': 90 })).toBe(true)
  })

  it('fires on creep that no single file owns', () => {
    expect(fires('recommended', baseline, scaled(1.04))).toBe(true)
  })

  // The clause that was here and had to go: on a pull request the baseline is
  // the merge base, so failing on a file with no entry fails the build for
  // adding tests. `baseline.ts`'s `unbudgeted` reports them instead.
  it('stays quiet on a cheap file with no baseline entry', () => {
    expect(fires('recommended', baseline, { ...flat(), 'added.test.ts': 1 })).toBe(false)
  })

  it('still fires when a new file is expensive enough to breach the total', () => {
    expect(fires('recommended', baseline, { ...flat(), 'added.test.ts': 400 })).toBe(true)
  })

  it('names the file and the reason, not just a verdict', () => {
    const [alarm] = gate('recommended').evaluate(baseline, { ...flat(), 'mid.test.ts': 90 })

    expect(alarm?.scope).toBe('mid.test.ts')
    expect(alarm?.reason).toMatch(/over the 40\.0ms baseline/)
  })

  it('raises no alarm naming a file it has no baseline for', () => {
    const alarms = gate('recommended').evaluate(baseline, { ...flat(), 'added.test.ts': 1 })

    expect(alarms.map((alarm) => alarm.scope)).not.toContain('added.test.ts')
  })
})

describe('a file the baseline knows and the run did not measure', () => {
  // Deleting a test file makes the suite faster, so no rule here should fire
  // on it. It is `missing()` in `baseline.ts` that reports it, and the gate
  // deliberately does not: a timing budget is not the place to police
  // deletions, and `shape/` already does.
  it('raises no alarm from any design', () => {
    const run = { 'tiny.test.ts': 2, 'mid.test.ts': 40 }

    for (const id of GATE_IDS) {
      expect(fires(id, baseline, run)).toBe(false)
    }
  })
})

/** A run that matches the baseline exactly. */
function flat(): Record<string, number> {
  return { 'tiny.test.ts': 2, 'mid.test.ts': 40, 'big.test.ts': 400 }
}

/** The baseline scaled uniformly. */
function scaled(by: number): Record<string, number> {
  return Object.fromEntries(Object.entries(flat()).map(([file, ms]) => [file, ms * by]))
}
