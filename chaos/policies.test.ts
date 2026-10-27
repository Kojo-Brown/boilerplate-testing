// @vitest-environment node
//
// The six wirings, exercised directly against the hand-written transports in
// `layers.ts`. No socket: this is the half of the behaviour that is the
// wiring's own logic rather than the transport's, and it is worth separating
// because the two halves fail differently. A retry that never re-attempts is a
// bug in `policies.ts`; a timeout that never fires against a real server and
// does fire here is the finding the whole directory is about.
//
// The environment is `node` rather than the suite's default `jsdom` for a
// reason that would otherwise be a mystery: these cases construct `Response`
// objects over `ReadableStream`s and pass real `AbortSignal`s, and jsdom's
// implementations of those are not the ones undici reads.

import { describe, expect, it } from 'vitest'

import { stubFetch } from './layers.ts'
import { HEALTHY_BODY, isHealthyBody } from './outcomes.ts'
import {
  BREAKER_THRESHOLD,
  BreakerOpenError,
  HttpStatusError,
  MAX_ATTEMPTS,
  POLICIES,
  POLICY_IDS,
  type FetchLike,
  type PolicyId,
  policy,
  wiringFor,
} from './policies.ts'

const URL_FOR = (id: string): string => `http://fetch-stub.invalid/${id}`

/** A transport that counts what it was asked for. */
function counting(inner: FetchLike): { readonly call: FetchLike; readonly count: () => number } {
  let count = 0

  return {
    call: (url, init) => {
      count += 1

      return inner(url, init)
    },
    count: () => count,
  }
}

describe('the wiring catalogue', () => {
  it('declares exactly the wirings the id list names, in the same order', () => {
    expect(POLICIES.map((entry) => entry.id)).toEqual([...POLICY_IDS])
  })

  it.each([...POLICY_IDS])('%s says what it is and what it claims', (id) => {
    const entry = policy(id)

    expect(entry.wiring.length).toBeGreaterThan(20)
    expect(entry.claims.length).toBeGreaterThan(10)
  })

  it('refuses an id it does not know', () => {
    // @ts-expect-error — the guard exists for the case the types forbid.
    expect(() => policy('not-a-policy')).toThrow('unknown policy')
  })

  it('builds a wiring for every id', () => {
    for (const id of POLICY_IDS) {
      expect(typeof wiringFor(id)).toBe('function')
    }
  })
})

describe('the healthy path', () => {
  it.each([...POLICY_IDS])('%s returns the dependency body when nothing is wrong', async (id) => {
    const body = await wiringFor(id)(URL_FOR('healthy'), stubFetch('healthy'))

    expect(isHealthyBody(body)).toBe(true)
    expect(body).toEqual(HEALTHY_BODY)
  })

  it.each([...POLICY_IDS])('%s makes exactly one request when nothing is wrong', async (id) => {
    const transport = counting(stubFetch('healthy'))

    await wiringFor(id)(URL_FOR('healthy'), transport.call)

    expect(transport.count()).toBe(1)
  })
})

describe('the status check', () => {
  // `bare` is the only wiring without one, and this is what that costs: a 500
  // resolves, with the error payload standing in for the data.
  it('bare resolves with the error payload', async () => {
    const body = await wiringFor('bare')(URL_FOR('error-500'), stubFetch('error-500'))

    expect(isHealthyBody(body)).toBe(false)
    expect(body).toEqual({ error: 'ledger unavailable' })
  })

  it.each(['race-timeout', 'signal-timeout'] as const)('%s rejects the status instead', async (id) => {
    await expect(wiringFor(id)(URL_FOR('error-500'), stubFetch('error-500'))).rejects.toThrow(HttpStatusError)
  })

  it('reports the status it rejected on', async () => {
    const failure = await wiringFor('signal-timeout')(URL_FOR('error-500'), stubFetch('error-500')).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(HttpStatusError)
    expect((failure as HttpStatusError).status).toBe(500)
  })
})

describe('the retry predicates', () => {
  it('retry-5xx re-attempts a 500 up to the attempt limit', async () => {
    const transport = counting(stubFetch('error-500'))

    await expect(wiringFor('retry-5xx')(URL_FOR('error-500'), transport.call)).rejects.toThrow(HttpStatusError)
    expect(transport.count()).toBe(MAX_ATTEMPTS)
  })

  // The hole in a status-keyed retry, stated as a unit case rather than left
  // to the matrix: a body that fails to parse never produced a status to key
  // on, so the retry branch is not entered at all.
  it('retry-5xx does not re-attempt a body that failed to parse', async () => {
    const transport = counting(stubFetch('malformed-body'))

    await expect(wiringFor('retry-5xx')(URL_FOR('malformed-body'), transport.call)).rejects.toThrow(SyntaxError)
    expect(transport.count()).toBe(1)
  })

  it('retry-any does re-attempt it', async () => {
    const transport = counting(stubFetch('malformed-body'))

    await expect(wiringFor('retry-any')(URL_FOR('malformed-body'), transport.call)).rejects.toThrow(SyntaxError)
    expect(transport.count()).toBe(MAX_ATTEMPTS)
  })

  it('both recover from a fault that heals, on the second attempt', async () => {
    for (const id of ['retry-5xx', 'retry-any'] as const satisfies readonly PolicyId[]) {
      const transport = counting(stubFetch('transient-500'))
      const body = await wiringFor(id)(URL_FOR('transient-500'), transport.call)

      expect(isHealthyBody(body)).toBe(true)
      expect(transport.count()).toBe(2)
    }
  })

  it('neither re-attempts a call that succeeded', async () => {
    const transport = counting(stubFetch('healthy'))

    await wiringFor('retry-any')(URL_FOR('healthy'), transport.call)

    expect(transport.count()).toBe(1)
  })
})

describe('the breaker', () => {
  it('opens after the threshold and then stops calling', async () => {
    const transport = counting(stubFetch('error-500'))
    const wiring = wiringFor('breaker')

    await expect(wiring(URL_FOR('error-500'), transport.call)).rejects.toThrow(BreakerOpenError)
    expect(transport.count()).toBe(BREAKER_THRESHOLD)

    // The second call makes no request at all, which is the entire point of
    // the mechanism and is invisible in what it throws.
    await expect(wiring(URL_FOR('error-500'), transport.call)).rejects.toThrow(BreakerOpenError)
    expect(transport.count()).toBe(BREAKER_THRESHOLD)
  })

  it('does not open on a fault that heals, because the failures are not consecutive', async () => {
    const wiring = wiringFor('breaker')
    const transport = counting(stubFetch('transient-500'))

    for (const call of [0, 1, 2]) {
      const body = await wiring(`${URL_FOR('transient-500')}?call=${String(call)}`, transport.call)

      expect(isHealthyBody(body)).toBe(true)
    }

    // One failure and one success per call: the success resets the counter, so
    // the breaker never reaches its threshold.
    expect(transport.count()).toBe(6)
  })

  // Each series gets its own breaker. A shared one would carry one fault's
  // failures into the next fault's cell, which is the leak `dbisolation/`
  // measures in databases and the reason `wiringFor('breaker')` is a factory.
  it('is fresh for every wiring built', async () => {
    const first = wiringFor('breaker')

    await expect(first(URL_FOR('error-500'), stubFetch('error-500'))).rejects.toThrow(BreakerOpenError)

    const second = wiringFor('breaker')
    const transport = counting(stubFetch('error-500'))

    await expect(second(URL_FOR('error-500'), transport.call)).rejects.toThrow(BreakerOpenError)
    expect(transport.count()).toBe(BREAKER_THRESHOLD)
  })
})

describe('the two timeouts, against the fault that separates them', () => {
  // The headline, as a unit case. Both wirings have a timeout; only one of
  // them is around the part of the call where the body is read.
  it('race-timeout returns a body it should have abandoned', async () => {
    const body = await wiringFor('race-timeout')(URL_FOR('slow-body'), stubFetch('slow-body'))

    expect(isHealthyBody(body)).toBe(true)
  })

  it('race-timeout does fire when the headers are the slow part', async () => {
    await expect(
      wiringFor('race-timeout')(URL_FOR('slow-headers'), stubFetch('slow-headers')),
    ).rejects.toThrow(/timed out/i)
  })
})
