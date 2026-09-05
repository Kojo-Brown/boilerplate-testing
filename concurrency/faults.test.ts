// @vitest-environment node
//
// Reads `ledger.ts` off disk and compiles copies of it, which needs the node
// environment for the same reason `determinism/faults.test.ts` does: jsdom's
// `import.meta.url` is not a file URL, so `fileURLToPath` throws.

import { describe, expect, it } from 'vitest'

import {
  applyEdits,
  FAULTS,
  FAULT_IDS,
  HAZARDS,
  HAZARD_NOTES,
  faultNamed,
} from './faults.ts'
import { ledgerSource, loadControl, loadFaulted } from './load.ts'

describe('the corpus', () => {
  it('declares every fault the ids name, once each', () => {
    expect(FAULTS.map((fault) => fault.id)).toEqual([...FAULT_IDS])
  })

  it('describes every fault as one sentence somebody could have written', () => {
    for (const fault of FAULTS) {
      expect(fault.description.endsWith('.')).toBe(true)
      expect(fault.edits.length).toBeGreaterThan(0)
    }
  })

  it('anchors every fault to a hazard, and uses every hazard it defines', () => {
    for (const fault of FAULTS) {
      expect(HAZARDS).toContain(fault.hazard)
    }

    expect([...new Set(FAULTS.map((fault) => fault.hazard))].sort()).toEqual([...HAZARDS].sort())
  })

  it('explains every hazard it defines', () => {
    expect(Object.keys(HAZARD_NOTES).sort()).toEqual([...HAZARDS].sort())
  })

  it('splits the corpus between bugs that need an interleaving and bugs that do not', () => {
    const sequential = FAULTS.filter((fault) => fault.hazard === 'sequential')

    expect(sequential).toHaveLength(3)
    expect(FAULTS.length - sequential.length).toBe(10)
  })
})

// The half that rots silently. An anchor that stops matching is a fault that
// stops being applied, and a corpus of no-op faults reports that every strategy
// catches everything.
describe('the edits, against the real source', () => {
  it('matches every anchor exactly once in `ledger.ts` as it stands', () => {
    const source = ledgerSource()

    for (const fault of FAULTS) {
      expect(() => applyEdits(source, fault.edits)).not.toThrow()
    }
  })

  it('changes the source for every fault', () => {
    const source = ledgerSource()

    for (const fault of FAULTS) {
      expect(applyEdits(source, fault.edits)).not.toBe(source)
    }
  })

  it('produces a different source for every fault', () => {
    const source = ledgerSource()
    const variants = new Set(FAULTS.map((fault) => applyEdits(source, fault.edits)))

    expect(variants.size).toBe(FAULTS.length)
  })

  it('refuses an anchor that matches nothing', () => {
    expect(() => applyEdits('const a = 1', [{ from: 'const b', to: 'const c' }])).toThrow(
      'edit anchor matched 0 times',
    )
  })

  it('refuses an anchor that matches twice', () => {
    expect(() => applyEdits('a\na\n', [{ from: 'a', to: 'b' }])).toThrow(
      'edit anchor matched 2 times',
    )
  })
})

describe('the compiled variants', () => {
  it('loads the unedited source through the same pipeline as the faults', async () => {
    const control = await loadControl()

    expect(typeof control.createLedger).toBe('function')
    expect(typeof control.createMutex).toBe('function')
  })

  it('compiles and loads every fault', async () => {
    for (const id of FAULT_IDS) {
      const variant = await loadFaulted(id)

      expect({ id, ledger: typeof variant.createLedger }).toEqual({ id, ledger: 'function' })
    }
  })

  it('refuses a fault it has no entry for', () => {
    // @ts-expect-error — the point of the check is the id that is not in the union.
    expect(() => faultNamed('NOT_A_FAULT')).toThrow('no fault named NOT_A_FAULT')
  })
})
