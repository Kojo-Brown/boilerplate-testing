/**
 * Every finding, asserted twice.
 *
 * Once as itself — the predicate must hold against the tables as declared — and
 * once against a table with one cell moved, which is the half that matters. A
 * predicate that reads no cell at all holds trivially and would sail through
 * the first assertion for ever; the perturbation is what proves the sentence in
 * the README is load-bearing rather than decorative.
 *
 * The structural checks come first, because a finding read off a malformed
 * table says nothing whichever way it comes out.
 */

import { describe, expect, it } from 'vitest'

import {
  captureCells,
  captureDifferences,
  captureProblems,
  EXPECTED_CAPTURE,
  gatesPassed,
  type CaptureRow,
} from './capture.ts'
import {
  brokenFindings,
  FINDINGS,
  FINDING_IDS,
  findingProblems,
  MEASURED,
  type Tables,
} from './findings.ts'
import {
  EXPECTED_ISOLATION,
  HAZARDS,
  hazardsCleared,
  isolationProblems,
  type IsolationRow,
} from './isolation.ts'
import { PROBES, PROBE_KEYS } from './probes.ts'
import { STRATEGIES, STRATEGY_KEYS } from './strategies.ts'
import { WIRINGS, WIRING_KEYS } from './wirings.ts'

describe('the tables are well formed before anything is read off them', () => {
  it('reports no structural problem in the capture table', () => {
    expect(captureProblems()).toEqual([])
  })

  it('reports no structural problem in the isolation table', () => {
    expect(isolationProblems()).toEqual([])
  })

  it('reports no vocabulary mismatch between the findings and the tables', () => {
    expect(findingProblems()).toEqual([])
  })

  it('has a capture cell for every wiring and probe', () => {
    expect(captureCells()).toHaveLength(WIRING_KEYS.length * PROBE_KEYS.length)
  })
})

describe('the findings hold against the tables as measured', () => {
  it('leaves no finding broken', () => {
    expect(brokenFindings()).toEqual([])
  })

  for (const finding of FINDINGS) {
    it(`${finding.id} holds`, () => {
      expect(finding.holds(MEASURED)).toBe(true)
    })
  }

  it('gives every finding a distinct id', () => {
    expect(new Set(FINDING_IDS).size).toBe(FINDING_IDS.length)
  })

  it('covers both halves', () => {
    expect(new Set(FINDINGS.map((finding) => finding.half))).toEqual(
      new Set(['capture', 'isolation']),
    )
  })
})

/**
 * Move one cell and hand the finding the result.
 *
 * `structuredClone` rather than a spread: the rows are nested and a shallow
 * copy would mutate the module's own table, so the perturbation would leak into
 * every test that ran after it — including the ones asserting the table is
 * unperturbed, which would then pass or fail depending on file order.
 */
function withCapture(wiring: string, probe: string, verdict: string): Tables {
  const capture = structuredClone(EXPECTED_CAPTURE) as Record<string, Record<string, string>>

  capture[wiring] = { ...(capture[wiring] ?? {}), [probe]: verdict }

  return { capture: capture as Readonly<Record<string, CaptureRow>>, isolation: MEASURED.isolation }
}

function withIsolation(strategy: string, change: Partial<IsolationRow>): Tables {
  const isolation = structuredClone(EXPECTED_ISOLATION) as Record<string, IsolationRow>

  isolation[strategy] = { ...(isolation[strategy] as IsolationRow), ...change }

  return { capture: MEASURED.capture, isolation }
}

/**
 * One perturbation per finding, and the finding it is expected to break.
 *
 * This is the half that makes the findings mean something. A predicate that
 * reads no cell holds trivially against the measured tables and would pass the
 * suite above for ever; here each one is handed a table with a single cell
 * moved and is required to notice. The perturbations are also deliberately
 * *small* — one cell, one number — because a finding that only fires when half
 * the table changes is not reading the sentence it claims to.
 */
const PERTURBATIONS: readonly { readonly breaks: string; readonly tables: Tables }[] = [
  {
    breaks: 'session-storage-never-survives',
    tables: withCapture('api-only', 'session-storage', 'present'),
  },
  {
    breaks: 'ui-login-buys-nothing-over-seeding',
    tables: withCapture('ui-login', 'session-storage', 'present'),
  },
  {
    breaks: 'one-option-moves-two-cells',
    tables: withCapture('ui-login-idb', 'local-storage', 'absent'),
  },
  {
    breaks: 'api-only-is-application-dependent',
    tables: withCapture('api-only', 'spa-gate', 'signed-in'),
  },
  {
    breaks: 'the-httponly-cookie-is-the-one-thing-kept',
    tables: withCapture('api-only', 'cookie', 'absent'),
  },
  {
    breaks: 'eviction-hides-the-collision',
    tables: withIsolation('shared-lazy', { 'parallel-mutation': 'collided' }),
  },
  {
    breaks: 'reuse-is-not-isolation',
    tables: withIsolation('shared-file', { 'parallel-mutation': 'isolated' }),
  },
  {
    breaks: 'one-identifier-one-cell',
    tables: withIsolation('per-parallel-index', { 'session-eviction': 'evicted' }),
  },
  {
    breaks: 'the-inheritance-is-visible-in-the-cost-column',
    tables: withIsolation('per-parallel-index', { logins: 4 }),
  },
  {
    breaks: 'per-test-buys-nothing-over-per-worker-index',
    tables: withIsolation('per-test', { 'restart-inheritance': 'inherited' }),
  },
  {
    breaks: 'no-strategy-clears-everything-cheaply',
    tables: withIsolation('per-test', { accounts: 1 }),
  },
]

describe('every finding notices when the cell it reads moves', () => {
  for (const { breaks, tables } of PERTURBATIONS) {
    it(`${breaks} fails against a table with one cell moved`, () => {
      expect(brokenFindings(tables)).toContain(breaks)
    })
  }

  it('perturbs every finding, so none is left unchecked', () => {
    expect(new Set(PERTURBATIONS.map((entry) => entry.breaks))).toEqual(new Set(FINDING_IDS))
  })

  it('leaves the measured tables untouched, whatever the perturbations did', () => {
    expect(brokenFindings()).toEqual([])
  })
})

describe('the helpers the findings are written in terms of', () => {
  it('reports no difference between a wiring and itself', () => {
    expect(captureDifferences('ui-login', 'ui-login')).toEqual([])
  })

  it('reports every probe as different between the two extremes of the table', () => {
    // `api-only` and `ui-login-idb` agree on the cookie and on the server gate,
    // so "every probe" is wrong and the helper had better say so: this is the
    // assertion that stops `captureDifferences` from being a function that
    // always returns everything.
    expect(captureDifferences('api-only', 'ui-login-idb')).toEqual([
      'local-storage',
      'indexed-db',
      'spa-gate',
      'idb-gate',
    ])
  })

  it('counts three gates cleared for the wiring that signs all three applications in', () => {
    expect(gatesPassed('ui-login-idb')).toBe(
      PROBES.filter((probe) => probe.family === 'gate').length,
    )
  })

  it('counts no hazard cleared for the strategy that fails all three', () => {
    expect(hazardsCleared('shared-lazy')).toBe(0)
  })

  it('counts every hazard cleared for the most isolated strategy', () => {
    expect(hazardsCleared('per-test')).toBe(HAZARDS.length)
  })
})

describe('the declarations the tables index', () => {
  it('names every wiring once', () => {
    expect(new Set(WIRING_KEYS).size).toBe(WIRINGS.length)
  })

  it('names every strategy once', () => {
    expect(new Set(STRATEGY_KEYS).size).toBe(STRATEGIES.length)
  })

  it('names every probe once', () => {
    expect(new Set(PROBE_KEYS).size).toBe(PROBES.length)
  })

  it('gives every wiring a provenance, so a reader can go and disagree with it', () => {
    expect(WIRINGS.filter((wiring) => wiring.provenance.trim() === '')).toEqual([])
  })

  it('gives every strategy a provenance', () => {
    expect(STRATEGIES.filter((strategy) => strategy.provenance.trim() === '')).toEqual([])
  })
})
