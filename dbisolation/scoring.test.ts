// @vitest-environment node
/**
 * The scoring rule, on synthetic runs.
 *
 * `scoreStrategy` is the reason the detection matrix means what it says, and it
 * is worth pinning away from a container because the rule it implements is the
 * one a reader is most likely to assume is simpler than it is: a red behaviour
 * is *not* a detection unless the same behaviour was green on the correct
 * subject.
 *
 * Without that subtraction, `rollback-savepoint` scores 10/10 — `notification`
 * is red on every faulted run, because it is red on every run — and the
 * directory's headline finding reverses.
 */

import { describe, expect, it } from 'vitest'

import type { Fault } from './faults.ts'
import type { SuiteRun } from './scoring.ts'
import { scoreStrategy } from './scoring.ts'

const result = (behaviour: string, red: boolean) => ({ behaviour, red, detail: red ? 'nope' : null })

const run = (fault: Fault | null, results: readonly { behaviour: string; red: boolean }[]): SuiteRun => ({
  strategy: 's',
  fault,
  results: results.map((entry) => result(entry.behaviour, entry.red)),
})

describe('scoreStrategy', () => {
  it('counts a behaviour that went green to red as a detection', () => {
    const report = scoreStrategy('s', [
      run(null, [{ behaviour: 'total', red: false }]),
      run('ORPHAN_LINE', [{ behaviour: 'total', red: true }]),
    ])

    expect(report.detection.get('ORPHAN_LINE')).toBe('caught')
    expect(report.catchers.get('ORPHAN_LINE')).toEqual(['total'])
    expect(report.falseAlarms).toEqual([])
  })

  it('does not count a behaviour that was already red', () => {
    const report = scoreStrategy('s', [
      run(null, [{ behaviour: 'notification', red: true }]),
      run('NOTIFY_MISSING', [{ behaviour: 'notification', red: true }]),
    ])

    expect(report.falseAlarms).toEqual(['notification'])
    expect(report.detection.get('NOTIFY_MISSING')).toBe('missed')
    expect(report.catchers.get('NOTIFY_MISSING')).toEqual([])
  })

  it('still counts the other behaviours in a run that has a false alarm in it', () => {
    const report = scoreStrategy('s', [
      run(null, [
        { behaviour: 'notification', red: true },
        { behaviour: 'total', red: false },
      ]),
      run('TOTAL_NOT_RECOMPUTED', [
        { behaviour: 'notification', red: true },
        { behaviour: 'total', red: true },
      ]),
    ])

    expect(report.detection.get('TOTAL_NOT_RECOMPUTED')).toBe('caught')
    expect(report.catchers.get('TOTAL_NOT_RECOMPUTED')).toEqual(['total'])
  })

  it('scores a fault nothing noticed as missed', () => {
    const report = scoreStrategy('s', [
      run(null, [{ behaviour: 'total', red: false }]),
      run('DUPLICATE_REF', [{ behaviour: 'total', red: false }]),
    ])

    expect(report.detection.get('DUPLICATE_REF')).toBe('missed')
  })

  it('ignores runs belonging to another strategy', () => {
    const other: SuiteRun = { strategy: 'other', fault: 'ORPHAN_LINE', results: [result('total', true)] }
    const report = scoreStrategy('s', [run(null, [{ behaviour: 'total', red: false }]), other])

    expect([...report.detection.keys()]).toEqual([])
  })

  it('refuses to score without a control run', () => {
    expect(() => scoreStrategy('s', [run('ORPHAN_LINE', [{ behaviour: 'total', red: true }])])).toThrow(
      /No control run/,
    )
  })
})
