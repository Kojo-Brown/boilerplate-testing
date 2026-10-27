// The findings, held to the standard that makes a finding worth publishing:
// each one has to *notice*.
//
// `readme.test.ts` checks that every finding still holds of the measurement,
// which is necessary and nowhere near sufficient — a predicate of the form
// `() => true` passes it. So every finding here is handed a copy of the tables
// with a single cell moved and required to return false. A finding that
// survives perturbation is decoration with a heading over it, and this is the
// file that says so.
//
// The perturbations are deliberately small and plausible: one column of one
// cell, changed to a value the vocabulary allows. A finding that only notices
// a table full of nonsense has not been tested.

import { describe, expect, it } from 'vitest'

import { FAULT_IDS, type FaultId } from './faults.ts'
import { LAYER_IDS, type LayerId } from './layers.ts'
import type { Cell, Table } from './outcomes.ts'
import { TABLES } from './matrix.ts'
import { POLICY_IDS, type PolicyId } from './policies.ts'
import { disagreements, FINDINGS, type Tables } from './render.ts'

/** The tables with one cell replaced. Structural copy; nothing is shared. */
function moved(
  layer: LayerId,
  policy: PolicyId,
  fault: FaultId,
  change: Partial<Cell>,
): Tables {
  const copy = Object.fromEntries(
    LAYER_IDS.map((id) => [
      id,
      Object.fromEntries(
        POLICY_IDS.map((row) => [
          row,
          Object.fromEntries(FAULT_IDS.map((column) => [column, { ...TABLES[id][row][column] }])),
        ]),
      ),
    ]),
  ) as Record<LayerId, Record<PolicyId, Record<FaultId, Cell>>>

  copy[layer][policy][fault] = { ...copy[layer][policy][fault], ...change }

  return copy as Readonly<Record<LayerId, Table>>
}

/**
 * One perturbation per finding, chosen to be the smallest edit that should
 * falsify it.
 *
 * Written as a table rather than as seven tests so that a finding added
 * without a perturbation fails the audit at the bottom of this file. That is
 * the half that keeps this honest over time: the easy way to pass a
 * perturbation suite is to stop adding rows to it.
 */
const PERTURBATIONS: readonly {
  readonly heading: string
  readonly why: string
  readonly tables: Tables
}[] = [
  {
    heading: 'One fault in nine separates a timeout that works from one that does not',
    why: 'the broken wiring is given the correct verdict on the one fault that separates them',
    tables: moved('socket', 'race-timeout', 'slow-body', { outcome: 'aborted', band: 'prompt' }),
  },
  {
    heading: 'A wiring with no status check hands the error payload back as data',
    why: 'the unchecked wiring is made to reject the status like every other row',
    tables: moved('socket', 'bare', 'error-500', { outcome: 'http-error' }),
  },
  {
    heading: 'Retrying on any error changes no outcome and triples the requests',
    why: 'one of the six amplified columns is given the cheaper wiring\'s request count',
    tables: moved('socket', 'retry-any', 'reset-mid-body', { requests: 3 }),
  },
  {
    heading: 'The breaker row says nothing about the dependency',
    why: 'one of the seven constant cells is given a verdict that describes the fault',
    tables: moved('socket', 'breaker', 'reset-mid-body', { outcome: 'reset', requests: 3 }),
  },
  {
    heading: 'The cheap injection layer is faithful about events and backwards about waiting',
    why: 'the stub is made to agree with the socket on one of the twelve cells',
    tables: moved('fetch-stub', 'signal-timeout', 'slow-body', { outcome: 'aborted', band: 'prompt' }),
  },
  {
    heading: 'At the stub layer the broken wiring is the only one that looks correct',
    why: 'one correct wiring is made to look correct at the stub layer too',
    tables: moved('fetch-stub', 'retry-any', 'slow-headers', { outcome: 'aborted', band: 'prompt' }),
  },
  {
    heading: 'A breaker cannot open against a dependency that never answers',
    why: 'the breaker is made to open against the fault it cannot see',
    tables: moved('fetch-stub', 'breaker', 'black-hole', { outcome: 'breaker-open', band: 'prompt', requests: 2 }),
  },
]

const findingFor = (heading: string) => FINDINGS.find((candidate) => candidate.heading === heading)

describe('every finding holds of the measurement', () => {
  it.each(FINDINGS.map((finding) => finding.heading))('"%s"', (heading) => {
    expect(findingFor(heading)?.holds(TABLES)).toBe(true)
  })
})

describe('every finding notices a single cell moving', () => {
  it.each(PERTURBATIONS.map((entry) => [entry.heading, entry.why] as const))(
    '"%s" fails when %s',
    (heading, _why) => {
      const perturbation = PERTURBATIONS.find((entry) => entry.heading === heading)
      const finding = findingFor(heading)

      expect(finding).toBeDefined()
      expect(perturbation).toBeDefined()
      // The control: the same predicate passes on the real tables, so a false
      // here is the perturbation and not a broken predicate.
      expect(finding?.holds(TABLES)).toBe(true)
      expect(finding?.holds(perturbation!.tables)).toBe(false)
    },
  )

  it('has a perturbation for every finding', () => {
    expect(PERTURBATIONS.map((entry) => entry.heading)).toEqual(FINDINGS.map((finding) => finding.heading))
  })
})

describe('the perturbation harness itself', () => {
  // Without this, a bug that made `moved` return the original tables would
  // turn every case above into a tautology in the wrong direction — and they
  // would all fail, which is at least loud. The case worth guarding is the
  // opposite one: a `moved` that mutated `TABLES` in place would make the
  // control assertion fail in whichever test ran second.
  it('does not touch the published tables', () => {
    const before = JSON.stringify(TABLES)

    moved('socket', 'bare', 'healthy', { outcome: 'hung', band: 'deadline', requests: 99 })

    expect(JSON.stringify(TABLES)).toBe(before)
  })

  it('changes exactly the cell it was asked to', () => {
    const tables = moved('socket', 'bare', 'healthy', { requests: 99 })

    expect(tables.socket.bare.healthy.requests).toBe(99)
    expect(tables.socket.bare.healthy.outcome).toBe('ok')
    expect(tables.socket['race-timeout'].healthy).toEqual(TABLES.socket['race-timeout'].healthy)
    expect(tables['fetch-stub'].bare.healthy).toEqual(TABLES['fetch-stub'].bare.healthy)
  })

  it('reports the twelve disagreements the second table is built from', () => {
    expect(disagreements(TABLES)).toHaveLength(12)
  })
})
