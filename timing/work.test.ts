// @vitest-environment node
//
// `spin` lives in `timing/fixture/`, which `vitest.config.ts` excludes from
// this suite because those five files are the subject of the measurement
// rather than tests of anything. The helper itself is ordinary code and is
// tested here, outside the excluded directory, so that excluding the fixture
// does not quietly stop covering the one function every recorded duration in
// `corpus.json` depends on.
//
// Every clock read in this file goes through `measure`, so the directory's
// registry entry in `determinism/registry.ts` is one row of two reads rather
// than six scattered through the assertions.

import { describe, expect, it } from 'vitest'

import { spin } from './fixture/work.ts'

/** How long `work` took, in ms — the only clock read in this file. */
function measure(work: () => void): number {
  const before = performance.now()

  work()

  return performance.now() - before
}

describe('spin', () => {
  it('burns at least the wall clock it was asked for', () => {
    expect(measure(() => spin(20))).toBeGreaterThanOrEqual(19)
  })

  it('returns the work it did, so neither the engine nor a reader can treat the loop as dead', () => {
    expect(spin(5)).toBeGreaterThan(0)
  })

  it('returns promptly for a zero duration', () => {
    expect(measure(() => spin(0))).toBeLessThan(50)
  })

  it('takes longer for a longer request', () => {
    expect(measure(() => spin(60))).toBeGreaterThan(measure(() => spin(5)))
  })

  it('refuses a negative duration', () => {
    expect(() => spin(-1)).toThrow(/not a duration/)
  })

  it('refuses a duration that is not a number', () => {
    expect(() => spin(Number.NaN)).toThrow(/not a duration/)
  })
})
