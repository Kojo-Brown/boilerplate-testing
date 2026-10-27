// The classifier, put to the cases that could flatter a measurement.
//
// Every rule here is a function over plain data, so these are the assertions
// that cost nothing and catch the most: a vocabulary that collapsed two
// different failures into one word would make the broken wirings in
// `policies.ts` score like the correct ones, and no amount of running real
// sockets would notice.

import { describe, expect, it } from 'vitest'

import {
  BANDS,
  BAND_NOTES,
  band,
  classify,
  HEALTHY_BODY,
  isHealthyBody,
  OUTCOMES,
  OUTCOME_NOTES,
  sameCell,
  type Cell,
  type ErrorShape,
} from './outcomes.ts'
import { BUDGET_MS, DEADLINE_MS, INJECTED_MS, WAITED_OUT_FLOOR_MS } from './timings.ts'

const thrown = (name: string, causeCode: string | null = null, message = 'x'): ErrorShape => ({
  name,
  message,
  causeCode,
})

describe('the outcome vocabulary', () => {
  it('has a note for every word and no note for anything else', () => {
    expect(Object.keys(OUTCOME_NOTES).sort()).toEqual([...OUTCOMES].sort())
  })

  it('has a note for every band and no note for anything else', () => {
    expect(Object.keys(BAND_NOTES).sort()).toEqual([...BANDS].sort())
  })
})

describe('recognising a healthy body', () => {
  it('accepts the body the origin sends', () => {
    expect(isHealthyBody(HEALTHY_BODY)).toBe(true)
  })

  it('accepts a body with extra fields, because a dependency may add one', () => {
    expect(isHealthyBody({ ...HEALTHY_BODY, requestId: 'abc' })).toBe(true)
  })

  // The case that matters: an error payload is valid JSON, so a wiring with no
  // status check resolves with *something*. If that counted as healthy, the
  // `bare` row's two `wrong-body` cells would read `ok` and the finding about
  // them would be gone.
  it('rejects an error payload', () => {
    expect(isHealthyBody({ error: 'ledger unavailable' })).toBe(false)
  })

  it.each([[null], [undefined], ['a string'], [42], [[]]])('rejects %s', (body) => {
    expect(isHealthyBody(body)).toBe(false)
  })

  it('rejects a body whose ok is the string "true"', () => {
    expect(isHealthyBody({ dependency: 'ledger', ok: 'true' })).toBe(false)
  })
})

describe('classifying a settled call', () => {
  it('calls a healthy body ok', () => {
    expect(classify({ settled: 'resolved', body: HEALTHY_BODY, elapsedMs: 5 })).toBe('ok')
  })

  it('calls anything else that parsed wrong-body', () => {
    expect(classify({ settled: 'resolved', body: { error: 'nope' }, elapsedMs: 5 })).toBe('wrong-body')
  })

  it('calls a deadline hung', () => {
    expect(classify({ settled: 'deadline', elapsedMs: DEADLINE_MS })).toBe('hung')
  })

  it.each([
    ['TimeoutError', null, 'aborted'],
    ['BreakerOpenError', null, 'breaker-open'],
    ['HttpStatusError', null, 'http-error'],
    ['SyntaxError', null, 'malformed'],
  ] as const)('maps a thrown %s to %s', (name, code, expected) => {
    expect(classify({ settled: 'rejected', error: thrown(name, code), elapsedMs: 1 })).toBe(expected)
  })

  // The branch whose ordering is load-bearing. undici reports both a refused
  // connection and a socket that died mid-body as a `TypeError`; only
  // `cause.code` tells them apart, and the directory has a column for each.
  it('tells a refused connection from a reset one by the cause code alone', () => {
    const refused = classify({
      settled: 'rejected',
      error: thrown('TypeError', 'ECONNREFUSED', 'fetch failed'),
      elapsedMs: 1,
    })
    const reset = classify({
      settled: 'rejected',
      error: thrown('TypeError', 'UND_ERR_SOCKET', 'terminated'),
      elapsedMs: 1,
    })

    expect([refused, reset]).toEqual(['refused', 'reset'])
  })

  // Deliberately *not* keyed on the message, so that a Node release rewording
  // `fetch failed` does not silently move a column.
  it('does not read the message to tell them apart', () => {
    expect(
      classify({
        settled: 'rejected',
        error: thrown('TypeError', 'UND_ERR_SOCKET', 'fetch failed'),
        elapsedMs: 1,
      }),
    ).toBe('reset')
  })

  it('refuses to guess at a TypeError with no cause code', () => {
    expect(classify({ settled: 'rejected', error: thrown('TypeError', null), elapsedMs: 1 })).toBe('other')
  })

  it('classifies an unrecognised error as other rather than as a failure word', () => {
    expect(classify({ settled: 'rejected', error: thrown('RangeError'), elapsedMs: 1 })).toBe('other')
  })
})

describe('the elapsed bands', () => {
  it('calls an immediate answer prompt', () => {
    expect(band(2)).toBe('prompt')
  })

  it('calls a timeout firing on schedule prompt, because it did not wait', () => {
    expect(band(BUDGET_MS + 2)).toBe('prompt')
  })

  it('calls a wiring that endured the fault waited-out', () => {
    expect(band(INJECTED_MS + 1)).toBe('waited-out')
  })

  it('calls a call that never settled deadline', () => {
    expect(band(DEADLINE_MS)).toBe('deadline')
  })

  // The boundary that was got wrong first. Both of these are real measured
  // populations, and the floor has to sit between them with room to spare —
  // see the derivation in `timings.ts`.
  it('puts the slowest retrying wiring and the fastest enduring one on opposite sides', () => {
    expect(band(3 * BUDGET_MS)).toBe('prompt')
    expect(band(INJECTED_MS + 0.5)).toBe('waited-out')
  })

  it('keeps at least 200ms of clearance on both sides of the floor', () => {
    expect(WAITED_OUT_FLOOR_MS - 3 * BUDGET_MS).toBeGreaterThanOrEqual(200)
    expect(INJECTED_MS - WAITED_OUT_FLOOR_MS).toBeGreaterThanOrEqual(200)
  })
})

describe('comparing cells', () => {
  const cell: Cell = { outcome: 'ok', band: 'prompt', requests: 3 }

  it('agrees with itself', () => {
    expect(sameCell(cell, { ...cell })).toBe(true)
  })

  it.each([
    ['outcome', { ...cell, outcome: 'aborted' } as Cell],
    ['band', { ...cell, band: 'waited-out' } as Cell],
    ['requests', { ...cell, requests: 9 }],
  ])('notices a %s that moved', (_column, moved) => {
    expect(sameCell(cell, moved)).toBe(false)
  })
})
