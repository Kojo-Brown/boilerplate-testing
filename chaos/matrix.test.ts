// The written-down measurement, audited as a table.
//
// None of this re-runs anything — `runs.test.ts` does that — and none of it
// could discover that a cell is wrong. What it catches is the other failure
// mode, the one a re-derivation cannot see: a table that is internally
// inconsistent, or that quietly stopped being closed over its own vocabulary.

import { describe, expect, it } from 'vitest'

import { FAULT_IDS } from './faults.ts'
import { LAYER_IDS, LAYERS, layer } from './layers.ts'
import { OUTCOMES, BANDS } from './outcomes.ts'
import {
  CELLS_PER_TABLE,
  ORIGIN_HITS,
  TABLES,
  TOTAL_CELLS,
  cellAt,
  harnessRequests,
} from './matrix.ts'
import { MAX_ATTEMPTS, POLICY_IDS, SERIES_LENGTH } from './policies.ts'

describe('the layer catalogue', () => {
  it('declares exactly the layers the id list names', () => {
    expect(LAYERS.map((entry) => entry.id)).toEqual([...LAYER_IDS])
  })

  it('leads with the ground truth, because every other row is compared to it', () => {
    expect(LAYER_IDS[0]).toBe('socket')
  })

  it('refuses an id it does not know', () => {
    // @ts-expect-error — the guard exists for the case the types forbid.
    expect(() => layer('not-a-layer')).toThrow('unknown layer')
  })
})

describe('the shape of the tables', () => {
  it('counts its own cells', () => {
    expect(CELLS_PER_TABLE).toBe(54)
    expect(TOTAL_CELLS).toBe(108)
  })

  it('has a cell for every layer, wiring and fault, and nothing else', () => {
    for (const id of LAYER_IDS) {
      expect(Object.keys(TABLES[id]).sort()).toEqual([...POLICY_IDS].sort())

      for (const policy of POLICY_IDS) {
        expect(Object.keys(TABLES[id][policy]).sort()).toEqual([...FAULT_IDS].sort())
      }
    }
  })

  it('holds only words from the two vocabularies', () => {
    for (const id of LAYER_IDS) {
      for (const policy of POLICY_IDS) {
        for (const fault of FAULT_IDS) {
          expect(OUTCOMES).toContain(cellAt(id, policy, fault).outcome)
          expect(BANDS).toContain(cellAt(id, policy, fault).band)
        }
      }
    }
  })

  // `other` means the classifier met something it does not have a word for.
  // It is a legal value so that a run can report one, and an illegal *cell* so
  // that a run reporting one fails instead of publishing it.
  it('publishes no unclassified cell', () => {
    for (const id of LAYER_IDS) {
      for (const policy of POLICY_IDS) {
        for (const fault of FAULT_IDS) {
          expect(cellAt(id, policy, fault).outcome).not.toBe('other')
        }
      }
    }
  })

  it('never records fewer requests than there are calls, nor more than attempts allow', () => {
    for (const id of LAYER_IDS) {
      for (const policy of POLICY_IDS) {
        for (const fault of FAULT_IDS) {
          const { requests } = cellAt(id, policy, fault)

          // The floor is the breaker, which can decline to call: one request
          // per failure it needs to open, and none after.
          expect(requests).toBeGreaterThanOrEqual(2)
          expect(requests).toBeLessThanOrEqual(SERIES_LENGTH * MAX_ATTEMPTS)
        }
      }
    }
  })

  it('agrees with the deadline band only where a call never settled', () => {
    for (const id of LAYER_IDS) {
      for (const policy of POLICY_IDS) {
        for (const fault of FAULT_IDS) {
          const { outcome, band } = cellAt(id, policy, fault)

          expect(band === 'deadline').toBe(outcome === 'hung')
        }
      }
    }
  })

  // The control column. A cell here that is not a clean success means the
  // harness, not the dependency, and every column to its right would be
  // measuring that instead.
  it('has every wiring healthy against the control', () => {
    for (const id of LAYER_IDS) {
      for (const policy of POLICY_IDS) {
        expect(cellAt(id, policy, 'healthy')).toEqual({
          outcome: 'ok',
          band: 'prompt',
          requests: SERIES_LENGTH,
        })
      }
    }
  })
})

describe('the origin ledger', () => {
  it('counts a request for every fault the socket layer could reach', () => {
    for (const fault of FAULT_IDS) {
      if (fault === 'connection-refused') continue

      expect(ORIGIN_HITS[fault]).toBeGreaterThan(0)
    }
  })

  // The column measured against a port that was bound and closed. A non-zero
  // count here would mean the runs reached the live origin and the whole
  // `connection-refused` column is a measurement of something else.
  it('counts nothing for the fault that has no server behind it', () => {
    expect(ORIGIN_HITS['connection-refused']).toBe(0)
  })

  // The independent witness, checked against the thing it witnesses. Both
  // numbers are produced by `runs.ts` from different sources — one wraps the
  // transport, one is the server's own tally — and `runs.test.ts` re-derives
  // both. This is the same agreement asserted over the published table.
  it('agrees with what the published cells say was sent', () => {
    for (const fault of FAULT_IDS) {
      expect(ORIGIN_HITS[fault]).toBe(fault === 'connection-refused' ? 0 : harnessRequests(fault))
    }
  })
})
