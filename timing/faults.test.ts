// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { runs } from './corpus.ts'
import { total, type Run } from './durations.ts'
import { FAULT_IDS, FAULTS, cost, fault } from './faults.ts'

const sample = (): Run => {
  const [first] = runs()

  if (first === undefined) throw new Error('corpus has no runs')

  return first
}

describe('the fault catalogue', () => {
  it('declares one entry per id, in the same order', () => {
    expect(FAULTS.map((entry) => entry.id)).toEqual([...FAULT_IDS])
  })

  it('answers each id with its entry', () => {
    for (const id of FAULT_IDS) {
      expect(fault(id).id).toBe(id)
    }
  })

  it('refuses an id it does not know', () => {
    // @ts-expect-error -- the guard exists for callers without types.
    expect(() => fault('nope')).toThrow(/unknown fault/)
  })

  it('gives every entry a change, a note and a verdict', () => {
    for (const entry of FAULTS) {
      expect(entry.change).not.toBe('')
      expect(entry.note.length).toBeGreaterThan(40)
      expect(['quiet', 'fire']).toContain(entry.want)
      expect(['local', 'proportional']).toContain(entry.scaling)
    }
  })

  it('holds exactly one control, and it is the one that wants silence for free', () => {
    expect(cost('none', sample())).toBe(0)
    expect(fault('none').want).toBe('quiet')
  })

  it('holds exactly one proportional fault, which is the one with no culprit', () => {
    const proportional = FAULTS.filter((entry) => entry.scaling === 'proportional')

    expect(proportional.map((entry) => entry.id)).toEqual(['creep'])
  })
})

describe('applying a fault', () => {
  it('leaves the run untouched for the control', () => {
    const run = sample()

    expect(fault('none').apply(run)).toEqual(run)
  })

  it('does not mutate the run it is given', () => {
    const run = sample()
    const before = { ...run }

    fault('medium-doubled').apply(run)

    expect(run).toEqual(before)
  })

  it('changes only the file it names', () => {
    const run = sample()
    const after = fault('medium-doubled').apply(run)

    for (const file of Object.keys(run)) {
      if (file === 'fixture/medium.test.ts') continue
      expect(after[file]).toBe(run[file])
    }
  })

  it('doubles the file it says it doubles', () => {
    const run = sample()
    const after = fault('medium-doubled').apply(run)

    expect(after['fixture/medium.test.ts']).toBeCloseTo((run['fixture/medium.test.ts'] ?? 0) * 2, 6)
  })

  it('scales every file for the creep fault', () => {
    const run = sample()
    const after = fault('creep').apply(run)

    for (const file of Object.keys(run)) {
      expect(after[file]).toBeCloseTo((run[file] ?? 0) * 1.05, 6)
    }
  })

  it('adds a file the baseline cannot know about for the new-file fault', () => {
    const run = sample()
    const after = fault('new-file').apply(run)

    expect(Object.keys(after)).toHaveLength(Object.keys(run).length + 1)
    expect(after['fixture/added.test.ts']).toBe(150)
  })

  it('refuses to scale a file the run does not hold', () => {
    expect(() => fault('medium-doubled').apply({ 'other.test.ts': 1 })).toThrow(/has no/)
  })
})

describe('what a fault costs', () => {
  it('reports the control as free and every other fault as a slowdown', () => {
    const run = sample()

    for (const id of FAULT_IDS) {
      const measured = cost(id, run)

      if (id === 'none') expect(measured).toBe(0)
      else expect(measured).toBeGreaterThan(0)
    }
  })

  // The two dimensions the catalogue is built to separate: a 100% regression
  // worth one millisecond, and a 10% regression worth twenty-four.
  it('costs less to double the 1ms file than to slow the 242ms one by a tenth', () => {
    const run = sample()

    expect(cost('tiny-doubled', run)).toBeLessThan(cost('large-tenth', run))
  })

  it('never reduces the suite total', () => {
    const run = sample()

    for (const id of FAULT_IDS) {
      expect(total(fault(id).apply(run))).toBeGreaterThanOrEqual(total(run))
    }
  })
})
