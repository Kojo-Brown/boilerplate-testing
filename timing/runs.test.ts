// @vitest-environment node
//
// The published matrix, re-derived.
//
// Every cell of `matrix.ts` is produced again here from `corpus.json` and the
// gate designs, and compared. This is the suite that makes the table evidence
// rather than documentation: a threshold moved, a rule rewritten or a corpus
// re-recorded fails here, naming the cell.
//
// It is pure arithmetic over a committed file, so it is milliseconds. The real
// measurement — sixteen runs of the fixture through the Vitest CLI — happened
// once, in `record.ts`, and is held still. A suite that re-measured the
// machine on every run would have whatever it just observed as its expected
// value, which is the one thing a regression gate must not be.

import { describe, expect, it } from 'vitest'

import { CORPUS } from './corpus.ts'
import { FAULT_IDS, fault } from './faults.ts'
import { GATE_IDS, fires } from './gates.ts'
import { RUNS, TABLE, TALLIES, TOTAL_CELLS, scored } from './matrix.ts'
import { baselineFrom } from './baseline.ts'
import { runs as corpusRuns } from './corpus.ts'
import { correct, corpusBaseline, count, row, scores, tally } from './score.ts'

describe('the published matrix', () => {
  it('holds a cell for every design against every fault', () => {
    expect(TOTAL_CELLS).toBe(GATE_IDS.length * FAULT_IDS.length)
    expect(TOTAL_CELLS).toBe(49)
  })

  it('denominates every cell in the number of runs the corpus holds', () => {
    expect(RUNS).toBe(CORPUS.recorded.runs)
  })

  it.each(GATE_IDS)('re-derives every cell of the %s row from the corpus', (gateId) => {
    expect(row(gateId)).toEqual(TABLE[gateId])
  })

  it('re-derives the whole table', () => {
    expect(scores()).toEqual(TABLE)
  })

  it.each(GATE_IDS)('re-derives the %s tally', (gateId) => {
    expect(tally(gateId)).toBe(TALLIES[gateId])
  })

  it('keeps every cell within nought and the run count', () => {
    for (const gateId of GATE_IDS) {
      for (const faultId of FAULT_IDS) {
        expect(scored(gateId, faultId)).toBeGreaterThanOrEqual(0)
        expect(scored(gateId, faultId)).toBeLessThanOrEqual(RUNS)
      }
    }
  })

  it('refuses a cell that is not a count out of the run total', () => {
    // The parser in matrix.ts is what keeps a typo from becoming a result.
    expect(() => scored('none', 'nope' as never)).toThrow(/no cell for/)
  })
})

describe('scoring', () => {
  it('counts a design that never fires as zero against every fault', () => {
    for (const faultId of FAULT_IDS) {
      expect(count('none', faultId)).toBe(0)
    }
  })

  it('scores the control column as the number of runs failed for nothing', () => {
    // `file-percent` fires on three of sixteen identical, unchanged runs.
    expect(count('file-percent', 'none')).toBe(3)
    expect(count('recommended', 'none')).toBe(0)
  })

  it('reads a quiet fault as answered only when nothing fired', () => {
    expect(correct('none', 0, RUNS)).toBe(true)
    expect(correct('none', 1, RUNS)).toBe(false)
  })

  it('reads a firing fault as answered only when every run fired', () => {
    expect(correct('creep', RUNS, RUNS)).toBe(true)
    expect(correct('creep', RUNS - 1, RUNS)).toBe(false)
  })

  it('derives the baseline from the whole corpus by median', () => {
    const baseline = corpusBaseline()

    expect(baseline.runs).toBe(RUNS)
    expect(Object.keys(baseline.files).sort()).toEqual([...CORPUS.files])
  })
})

describe('the gate this directory ships, against a one-run baseline', () => {
  // The claim `check.ts` depends on, measured rather than assumed: CI records
  // one base run, not sixteen, so the shipped design has to survive a baseline
  // of a single observation. The first run becomes the baseline and the other
  // fifteen are held out, so nothing here is scored against its own median.
  const [first, ...held] = corpusRuns()

  if (first === undefined) throw new Error('corpus has no runs')

  const oneRun = baselineFrom([first])

  it('raises no false alarm on any of the fifteen held-out unchanged runs', () => {
    const falseAlarms = held.filter((run) => fires('recommended', oneRun, run))

    expect(falseAlarms).toHaveLength(0)
  })

  it('still catches a doubled file in every held-out run', () => {
    const caught = held.filter((run) =>
      fires('recommended', oneRun, fault('medium-doubled').apply(run)),
    )

    expect(caught).toHaveLength(held.length)
  })

  // The design that cannot be rescued by a better baseline: a percentage rule
  // over short files false-alarms against one run and against sixteen alike.
  it('leaves the percentage-only design false-alarming whatever the baseline', () => {
    const againstOne = held.filter((run) => fires('file-percent', oneRun, run)).length
    const againstAll = held.filter((run) => fires('file-percent', corpusBaseline(), run)).length

    expect(againstOne).toBeGreaterThan(0)
    expect(againstAll).toBeGreaterThan(0)
  })
})
