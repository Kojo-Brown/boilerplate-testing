// @vitest-environment node
//
// Reads `session.ts` off disk and compiles copies of it.

import { describe, expect, it } from 'vitest'

import { applyEdits, FAULTS, FAULT_IDS, faultNamed } from './faults.ts'
import { loadControl, loadFaulted, sessionSource } from './load.ts'

// The corpus's own integrity. Every result in this directory is a claim about
// fifteen specific changes to one specific file, and all of it is worthless if
// an edit silently stops matching — a fault that changes nothing is caught by
// nobody, and the matrix would report that as a limitation of every technique.

describe('the corpus', () => {
  it('declares one fault per identifier, in the declared order', () => {
    expect(FAULTS.map((fault) => fault.id)).toEqual([...FAULT_IDS])
  })

  it('names the fault asked for, and refuses one that does not exist', () => {
    expect(faultNamed('TTL_IN_SECONDS').source).toBe('wall-clock')
    expect(() => faultNamed('nonsense' as never)).toThrow(/no fault named/)
  })

  // The load-bearing check. An anchor that matches zero times is a no-op
  // fault; one that matches twice is two faults wearing one name.
  it('anchors every edit to exactly one place in the current source', () => {
    const source = sessionSource()

    for (const fault of FAULTS) {
      for (const edit of fault.edits) {
        expect({ fault: fault.id, occurrences: source.split(edit.from).length - 1 }).toEqual({
          fault: fault.id,
          occurrences: 1,
        })
      }
    }
  })

  it('changes the source for every fault', () => {
    const source = sessionSource()

    for (const fault of FAULTS) {
      expect(applyEdits(source, fault.edits)).not.toBe(source)
    }
  })

  it('produces a different source for every fault', () => {
    const source = sessionSource()
    const variants = new Set(FAULTS.map((fault) => applyEdits(source, fault.edits)))

    expect(variants.size).toBe(FAULTS.length)
  })
})

describe('applying an edit', () => {
  it('replaces the anchor it was given', () => {
    expect(applyEdits('a b c', [{ from: 'b', to: 'x' }])).toBe('a x c')
  })

  it('applies edits in order, so a later one can anchor on an earlier result', () => {
    expect(
      applyEdits('a b', [
        { from: 'a', to: 'c' },
        { from: 'c b', to: 'done' },
      ]),
    ).toBe('done')
  })

  it('refuses an anchor that matches nothing', () => {
    expect(() => applyEdits('a b c', [{ from: 'zzz', to: 'x' }])).toThrow(
      /matched 0 times, expected exactly 1/,
    )
  })

  it('refuses an anchor that matches more than once', () => {
    expect(() => applyEdits('a a', [{ from: 'a', to: 'x' }])).toThrow(
      /matched 2 times, expected exactly 1/,
    )
  })
})

describe('the compile-and-import pipeline', () => {
  it('loads the unedited source as a subject', async () => {
    const control = await loadControl()

    expect(typeof control.issue).toBe('function')
    expect(typeof control.timed).toBe('function')
  })

  // The control exists so that a pipeline which changed behaviour by itself
  // would be caught here rather than making every fault look detected.
  it('returns the same module for the control however often it is asked for', async () => {
    expect(await loadControl()).toBe(await loadControl())
  })

  it('loads every fault in the corpus', async () => {
    for (const fault of FAULT_IDS) {
      expect(typeof (await loadFaulted(fault)).refreshDelayMs).toBe('function')
    }
  })

  // Each variant is its own module, so an error thrown by one is not an
  // `instanceof` the class exported by another. Nothing here relies on that,
  // and this is the check that it stays true.
  it('keeps each faulted subject distinct from the control', async () => {
    for (const fault of FAULT_IDS) {
      expect(await loadFaulted(fault)).not.toBe(await loadControl())
    }
  })
})
