// @vitest-environment node
//
// The measurement, taken again.
//
// This is the file that makes `matrix.ts` a record rather than a claim: 108
// cells, produced by six wirings calling a real `node:http` origin and a
// hand-written `fetch`, compared cell by cell against what the README
// publishes. A cell that has moved fails here, which is the only way a
// document full of measurements stays true after the runtime underneath it
// changes.
//
// It runs once and asserts many times. `measure()` is called in a `beforeAll`
// rather than per test because it is a few seconds of real timers — the
// slowest cells are wirings with no working timeout sitting against
// `black-hole` until the harness gives up — and 108 separate runs of it would
// be minutes rather than seconds for no extra information.
//
// `node` rather than the suite's default `jsdom`: the whole subject is what
// undici's `fetch` does with a socket, and jsdom's is not undici's.

import { beforeAll, describe, expect, it } from 'vitest'

import { FAULT_IDS, type FaultId } from './faults.ts'
import { LAYER_IDS, type LayerId } from './layers.ts'
import { ORIGIN_HITS, TABLES, cellAt, harnessRequests } from './matrix.ts'
import { POLICY_IDS, type PolicyId } from './policies.ts'
import { type Measurement, measure } from './runs.ts'
import { startOrigin } from './origin.ts'

let measured: Measurement

beforeAll(async () => {
  measured = await measure()
}, 120_000)

/** Every cell, flat, for the assertions that walk them. */
const CASES: readonly [LayerId, PolicyId, FaultId][] = LAYER_IDS.flatMap((layer) =>
  POLICY_IDS.flatMap((policy) => FAULT_IDS.map((fault) => [layer, policy, fault] as [LayerId, PolicyId, FaultId])),
)

describe('the published cells are what the runs produce', () => {
  // One deep comparison per layer rather than 54 assertions each, and the
  // reason is the failure report rather than the line count: `toEqual` over
  // the whole table diffs *every* cell that moved in one message, where 54
  // separate cases stop being readable at about the third red one — and it
  // also catches a policy or fault key appearing or disappearing, which a
  // per-cell lookup cannot see at all.
  it.each([...LAYER_IDS])('every cell of the %s table', (layer) => {
    expect(measured.tables[layer]).toEqual(TABLES[layer])
  })

  // The headline cell, named on its own so that the one finding the whole
  // directory turns on fails by name rather than inside a table diff.
  it('still finds the broken timeout returning a body it should have abandoned', () => {
    expect(measured.tables.socket['race-timeout']['slow-body']).toEqual(
      cellAt('socket', 'race-timeout', 'slow-body'),
    )
    expect(measured.tables.socket['race-timeout']['slow-body'].outcome).toBe('ok')
    expect(measured.tables.socket['race-timeout']['slow-body'].band).toBe('waited-out')
    expect(measured.tables.socket['signal-timeout']['slow-body'].outcome).toBe('aborted')
  })
})

describe('the independent witness', () => {
  it.each([...FAULT_IDS])('the origin counted what the %s column says was sent', (fault) => {
    expect(measured.originHits[fault]).toBe(ORIGIN_HITS[fault])
  })

  // The agreement that matters. The `requests` column is counted by the
  // harness, which wraps the transport and would agree with itself whatever it
  // did; this is the same quantity read off the server that received them.
  it('agrees with the harness fault by fault', () => {
    for (const fault of FAULT_IDS) {
      const expected = fault === 'connection-refused' ? 0 : harnessRequests(fault)

      expect(measured.originHits[fault]).toBe(expected)
    }
  })

  it('never reached a live server for the fault that has no server', () => {
    expect(measured.originHits['connection-refused']).toBe(0)
  })
})

describe('the vocabulary held', () => {
  // `other` is what the classifier returns when it meets something it has no
  // word for — a reworded error, a changed cause code, a new rejection shape
  // from a Node upgrade. Nothing published may hold it, and this is the
  // assertion that turns such a change into a red build rather than into a
  // table that renders and means something else.
  it('classified every one of the 108 cells', () => {
    for (const [layer, policy, fault] of CASES) {
      expect(measured.tables[layer][policy][fault].outcome).not.toBe('other')
    }
  })
})

describe('the origin', () => {
  it('serves a dead URL on a port that really is closed', async () => {
    const origin = await startOrigin()

    try {
      expect(origin.deadUrl).not.toBe(origin.baseUrl)

      const failure = await fetch(`${origin.deadUrl}/healthy`).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(TypeError)
      expect((failure as { cause?: { code?: string } }).cause?.code).toBe('ECONNREFUSED')
    } finally {
      await origin.close()
    }
  })

  it('answers an unknown fault with a 404 rather than something plausible', async () => {
    const origin = await startOrigin()

    try {
      const response = await fetch(`${origin.baseUrl}/not-a-fault`)

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'no such fault: not-a-fault' })
    } finally {
      await origin.close()
    }
  })

  // The teardown that is not optional: `black-hole` parks a request for ever,
  // and `server.close()` on its own waits for it. Without
  // `closeAllConnections` this suite measures everything correctly and then
  // hangs, which is the worst way for a measurement to fail.
  it('closes even with a request parked against the black hole', async () => {
    const origin = await startOrigin()

    const parked = fetch(`${origin.baseUrl}/black-hole`).catch(() => 'rejected')

    await origin.close()

    await expect(parked).resolves.toBe('rejected')
  })

  it('counts what it is sent, per fault', async () => {
    const origin = await startOrigin()

    try {
      await (await fetch(`${origin.baseUrl}/healthy`)).json()
      await (await fetch(`${origin.baseUrl}/healthy`)).json()
      await (await fetch(`${origin.baseUrl}/error-500`)).json()

      expect(origin.hits('healthy')).toBe(2)
      expect(origin.hits('error-500')).toBe(1)
      expect(origin.hits('slow-body')).toBe(0)
    } finally {
      await origin.close()
    }
  })

  // `transient-500` is the one route with state, and the key is the whole
  // request target. Keyed on the path alone, the first wiring to run would
  // absorb the only failure and every wiring after it would measure a healthy
  // dependency — so this is the assertion that keeps that column meaningful.
  it('gives every distinctly stamped call its own first failure', async () => {
    const origin = await startOrigin()

    try {
      const first = await fetch(`${origin.baseUrl}/transient-500?series=a&call=0`)
      const second = await fetch(`${origin.baseUrl}/transient-500?series=a&call=0`)
      const other = await fetch(`${origin.baseUrl}/transient-500?series=b&call=0`)

      expect([first.status, second.status, other.status]).toEqual([500, 200, 500])
    } finally {
      await origin.close()
    }
  })
})

describe('the tables are stable enough to publish', () => {
  // Not a re-run — that would double the cost of the suite — but the next
  // best thing: the bands are the only cells that could move with load, and
  // every one of them is required to be a band whose boundaries have 300ms of
  // clearance. See the derivation in `timings.ts`.
  it('uses only the three bands, and `deadline` only where nothing settled', () => {
    for (const [layer, policy, fault] of CASES) {
      const cell = measured.tables[layer][policy][fault]

      expect(['prompt', 'waited-out', 'deadline']).toContain(cell.band)
      expect(cell.band === 'deadline').toBe(cell.outcome === 'hung')
    }
  })

  it('produced a table for both layers and nothing else', () => {
    expect(Object.keys(measured.tables).sort()).toEqual([...LAYER_IDS].sort())
    expect(Object.keys(TABLES).sort()).toEqual([...LAYER_IDS].sort())
  })
})
