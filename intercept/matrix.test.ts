/**
 * The table's own consistency, and every finding restated as an assertion.
 *
 * `fidelity.spec.ts` checks the table against Chromium; this suite checks it
 * against itself. The two catch different mistakes. A cell that says `stalee`
 * is caught here, in milliseconds, because no probe declares that word — the
 * browser suite would catch it too, after launching a browser, and would
 * report it as a difference rather than as a typo.
 *
 * The findings are the other half, and they are the reason this file is not
 * merely a schema check. Each one is a claim `README.md` makes in prose, asked
 * of the table as a function. A cell edited to make the browser suite pass
 * fails the finding that depended on it, which is the only way a measurement
 * and the paragraph explaining it stay in step.
 */

import { describe, expect, it } from 'vitest'

import { PROBE_NAMES, probeByName } from './probes'
import { CONDITIONS, WIRING_NAMES } from './wirings'
import {
  FINDINGS,
  MATRIX,
  REPLAY_WIRINGS,
  cell,
  differences,
  invalidCells,
  wiringsAnswering,
} from './matrix'

describe('the table is complete', () => {
  it('holds a row for every wiring under both conditions', () => {
    for (const wiring of WIRING_NAMES) {
      for (const condition of CONDITIONS) {
        expect(MATRIX[wiring][condition], `${wiring}/${condition} is missing`).toBeDefined()
      }
    }
  })

  it('answers every probe in every row', () => {
    for (const wiring of WIRING_NAMES) {
      for (const condition of CONDITIONS) {
        expect(Object.keys(MATRIX[wiring][condition]).sort()).toEqual([...PROBE_NAMES].sort())
      }
    }
  })

  it('counts 192 cells, which is what the browser suite claims to check', () => {
    expect(WIRING_NAMES.length * CONDITIONS.length * PROBE_NAMES.length).toBe(192)
  })
})

describe('every cell is a word its probe declares', () => {
  it('holds no value outside its own vocabulary', () => {
    expect(invalidCells()).toEqual([])
  })

  it('uses at least two of the words each probe offers, somewhere in the table', () => {
    // A probe every wiring answers identically is measuring nothing. The one
    // exception is stated rather than tolerated: see the test below.
    const constant = PROBE_NAMES.filter((probe) => {
      const values = new Set(
        WIRING_NAMES.flatMap((wiring) => CONDITIONS.map((condition) => cell(wiring, condition, probe))),
      )

      return values.size < 2
    })

    expect(constant).toEqual(['observed-by-test'])
  })

  it('leaves `echoes-recorded` unused, which is a finding rather than an oversight', () => {
    const used = new Set(
      WIRING_NAMES.flatMap((wiring) => CONDITIONS.map((condition) => cell(wiring, condition, 'post-echo'))),
    )

    expect(probeByName('post-echo')?.outcomes).toContain('echoes-recorded')
    expect(used.has('echoes-recorded')).toBe(false)
  })
})

describe('the control row', () => {
  it('has the origin answering everything while it is connected', () => {
    const row = MATRIX.live.connected

    expect(row['known-get']).toBe('origin')
    expect(row['unrecorded-get']).toBe('origin')
    expect(row['reaches-origin']).toBe('reached')
  })

  it('is the only row that reaches the origin at all', () => {
    expect(wiringsAnswering('connected', 'reaches-origin', 'reached')).toEqual(['live'])
  })

  it('fails everything once the network is severed, which is why the others exist', () => {
    const row = MATRIX.live.severed
    const requests = ['document', 'static-asset', 'known-get', 'drifted-get', 'post-echo'] as const

    for (const probe of requests) {
      expect(row[probe], `live/severed/${probe}`).toBe('failed')
    }
  })
})

describe('the helpers the findings are built from', () => {
  it('reports no difference between a row and itself', () => {
    expect(differences('live', 'live', 'connected')).toEqual([])
  })

  it('reports the probes two rows disagree on, in catalogue order', () => {
    const found = differences('abort-api', 'offline', 'severed')

    expect(found).toEqual(['online-flag', 'offline-event'])
  })

  it('selects wirings by any of several outcomes', () => {
    const answered = wiringsAnswering('connected', 'known-get', 'origin', 'stub')

    expect(answered).toContain('stub-fulfill')
    expect(answered).toContain('har-abort')
    expect(answered).not.toContain('abort-api')
  })

  it('lists only wirings the catalogue knows as replaying the recording', () => {
    for (const wiring of REPLAY_WIRINGS) {
      expect(WIRING_NAMES, `${wiring} is not a wiring`).toContain(wiring)
    }
  })
})

describe('the findings the README states', () => {
  it('names every finding exactly once', () => {
    const ids = FINDINGS.map((finding) => finding.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const finding of FINDINGS) {
    it(`holds: ${finding.id}`, () => {
      expect(finding.holds(), finding.claim).toBe('')
    })
  }
})
