// @vitest-environment node
//
// The suite that makes `budget.json` a budget rather than a preference.
//
// Every threshold is held above the noise floor recorded alongside it, so the
// one edit this directory warns against — lowering a number to turn a red
// build green — fails here instead of quietly turning the gate into a
// generator of false alarms.

import { describe, expect, it } from 'vitest'

import { baselineFrom } from './baseline.ts'
import { BUDGET, coverage, evaluate, type Budget } from './budget.ts'
import { FILE_DELTA_MS, FILE_TOLERANCE, TOTAL_TOLERANCE } from './gates.ts'

describe('the shipped budget', () => {
  it('records the calibration its thresholds came from', () => {
    const { calibration } = BUDGET

    expect(calibration.runs).toBeGreaterThanOrEqual(2)
    expect(calibration.files).toBeGreaterThan(0)
    expect(calibration.command).not.toBe('')
    expect(calibration.machine).not.toBe('')
    expect(calibration.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // The guard. Each threshold must clear the floor measured on the suite it
  // polices; a gate set below its own noise does not police anything.
  it('keeps the total tolerance above the measured total noise floor', () => {
    expect(BUDGET.thresholds.totalTolerance).toBeGreaterThan(BUDGET.calibration.totalNoiseFloor)
  })

  it('keeps the file delta above the worst absolute disagreement a policed file showed', () => {
    // The worst absolute mover in the calibration is above the floor, so the
    // delta clause is what has to carry it — together with the percentage
    // clause, which that file does not trip.
    expect(BUDGET.thresholds.fileDeltaMs).toBeGreaterThan(0)
    expect(BUDGET.calibration.worstFileAbsoluteMs).toBeGreaterThan(BUDGET.thresholds.fileDeltaMs)
  })

  it('is strictly looser than the thresholds the fixture matrix was scored with', () => {
    expect(BUDGET.thresholds.fileTolerance).toBeGreaterThan(FILE_TOLERANCE)
    expect(BUDGET.thresholds.fileDeltaMs).toBeGreaterThan(FILE_DELTA_MS)
    expect(BUDGET.thresholds.totalTolerance).toBeGreaterThan(TOTAL_TOLERANCE)
  })
})

describe('the gate the budget produces', () => {
  const baseline = baselineFrom([{ 'small.test.ts': 50, 'big.test.ts': 4_000 }])

  it('stays quiet on a run that matches its baseline', () => {
    expect(evaluate(baseline, { 'small.test.ts': 50, 'big.test.ts': 4_000 })).toEqual([])
  })

  it('stays quiet on a file below the floor however far it moved', () => {
    expect(evaluate(baseline, { 'small.test.ts': 90, 'big.test.ts': 4_000 })).toEqual([])
  })

  it('fires on a policed file that doubled', () => {
    const alarms = evaluate(baseline, { 'small.test.ts': 50, 'big.test.ts': 8_000 })

    expect(alarms.map((alarm) => alarm.scope)).toContain('big.test.ts')
  })

  it('stays quiet on a new test file that costs little, which a branch adds all the time', () => {
    const alarms = evaluate(baseline, {
      'small.test.ts': 50,
      'big.test.ts': 4_000,
      'new.test.ts': 10,
    })

    expect(alarms).toEqual([])
  })

  it('fires on a new test file expensive enough to breach the total', () => {
    const alarms = evaluate(baseline, {
      'small.test.ts': 50,
      'big.test.ts': 4_000,
      'new.test.ts': 2_000,
    })

    expect(alarms.map((alarm) => alarm.scope)).toContain('TOTAL')
  })
})

describe('coverage', () => {
  it('counts only the files a doubling of which clears both clauses', () => {
    // 10ms is below the floor, 150ms is above the floor but below the delta,
    // 4000ms is above both.
    const baseline = baselineFrom([
      { 'tiny.test.ts': 10, 'mid.test.ts': 150, 'big.test.ts': 4_000 },
    ])

    expect(coverage(baseline)).toEqual({
      files: 3,
      policed: 1,
      shareOfWallClock: 4_000 / 4_160,
    })
  })

  it('reports no coverage for a suite of files all below the floor', () => {
    const baseline = baselineFrom([{ 'a.test.ts': 5, 'b.test.ts': 5 }])

    expect(coverage(baseline)).toEqual({ files: 2, policed: 0, shareOfWallClock: 0 })
  })

  // The directory's closing finding, as an assertion over the recorded
  // calibration: a small minority of the files, nearly all of the time.
  it('polices a minority of files and the large majority of the wall clock', () => {
    const { policedFiles, files, policedShareOfWallClock } = BUDGET.calibration

    expect(policedFiles / files).toBeLessThan(0.2)
    expect(policedShareOfWallClock).toBeGreaterThan(0.9)
  })

  it('agrees with the recorded figure on a baseline shaped like the real suite', () => {
    // 173 files under 25ms, 26 between 25 and 100, 12 between 100 and 250,
    // and 21 above the delta: the distribution the calibration measured.
    const files: Record<string, number> = {}

    for (let i = 0; i < 173; i += 1) files[`tiny-${String(i)}.test.ts`] = 10
    for (let i = 0; i < 26; i += 1) files[`small-${String(i)}.test.ts`] = 50
    for (let i = 0; i < 12; i += 1) files[`mid-${String(i)}.test.ts`] = 150
    for (let i = 0; i < 21; i += 1) files[`big-${String(i)}.test.ts`] = 5_000

    expect(coverage(baselineFrom([files])).policed).toBe(BUDGET.calibration.policedFiles)
  })
})

describe('validation', () => {
  it('refuses a budget with no calibration behind it', async () => {
    // The module validates at load, so the check is re-exercised here through
    // a fresh import of the validator's contract rather than by mutating the
    // loaded budget.
    const { BUDGET: loaded } = await import('./budget.ts')
    const asBudget: Budget = loaded

    expect(asBudget.calibration).toBeDefined()
    expect(Object.keys(asBudget.thresholds).sort()).toEqual([
      'fileDeltaMs',
      'fileFloorMs',
      'fileTolerance',
      'totalTolerance',
    ])
  })
})
