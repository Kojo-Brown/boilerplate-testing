/**
 * The classifiers, put to the cases the browser suite happens not to produce.
 *
 * `fidelity.spec.ts` exercises these functions 192 times a run, and only ever
 * with the inputs eight wirings actually generate. That is a narrow slice: no
 * cell in the table is a 500 that was answered, a body with a schema from the
 * future, or an echo of a word nobody sent, and every one of those is a case
 * where a lenient classifier would quietly report success.
 *
 * So this suite hands them to the rules directly. It is the half of the
 * measurement that can be wrong in the flattering direction, which is the half
 * worth testing away from the thing being measured.
 */

import { describe, expect, it } from 'vitest'

import type { FetchOutcome, RetryOutcome } from './client'
import { CURRENT_SCHEMA, RECORDED_SCHEMA } from './origin'
import {
  STYLED_COLOUR,
  classifyDrift,
  classifyEcho,
  classifyFetch,
  classifyReach,
  classifyRetry,
  classifyStylesheet,
  echoedWord,
  schemaOf,
  sourceOf,
} from './outcomes'

const answered = (body: unknown, status = 200): FetchOutcome => ({
  failed: false,
  error: '',
  status,
  body,
})

const refused: FetchOutcome = {
  failed: true,
  error: 'net::ERR_FAILED',
  status: 0,
  body: null,
}

const attempts = (outcome: FetchOutcome, count: number): RetryOutcome => ({ ...outcome, attempts: count })

describe('sourceOf', () => {
  it('reads the stamp an origin body carries', () => {
    expect(sourceOf({ source: 'origin' })).toBe('origin')
  })

  it('reads the stamp a stub body carries', () => {
    expect(sourceOf({ source: 'stub' })).toBe('stub')
  })

  it('refuses a stamp it does not recognise rather than passing it through', () => {
    // A body claiming `source: 'cache'` is a body this directory did not
    // write, and treating it as a known source would put an unvetted string
    // into a cell.
    expect(sourceOf({ source: 'cache' })).toBeNull()
  })

  it('returns null for bodies that carry no stamp at all', () => {
    expect(sourceOf(null)).toBeNull()
    expect(sourceOf('a string')).toBeNull()
    expect(sourceOf({})).toBeNull()
  })
})

describe('schemaOf', () => {
  it('reads a numeric schema', () => {
    expect(schemaOf({ schema: 1 })).toBe(1)
  })

  it('returns null for a schema that is not a number', () => {
    expect(schemaOf({ schema: '1' })).toBeNull()
  })

  it('returns null for a body with no schema', () => {
    expect(schemaOf({ source: 'origin' })).toBeNull()
  })
})

describe('classifyFetch', () => {
  it('reports an origin body as the origin answering', () => {
    expect(classifyFetch(answered({ source: 'origin' }))).toBe('origin')
  })

  it('reports a stub body as the stub answering', () => {
    expect(classifyFetch(answered({ source: 'stub' }))).toBe('stub')
  })

  it('reports a body with no stamp as the origin, which is what a stylesheet is', () => {
    expect(classifyFetch(answered(null))).toBe('origin')
  })

  it('reports a refused request as failed', () => {
    expect(classifyFetch(refused)).toBe('failed')
  })

  it('reports an answered 503 as failed, not as an answer', () => {
    // The distinction that matters: the bytes arrived and the request did not
    // succeed. A classifier keyed on `failed` alone would call this an origin
    // response and make the retry column meaningless.
    expect(classifyFetch(answered({ source: 'origin' }, 503))).toBe('failed')
  })

  it('reports an answered 404 as failed', () => {
    expect(classifyFetch(answered({ source: 'origin' }, 404))).toBe('failed')
  })
})

describe('classifyDrift', () => {
  it('reports the current schema as the origin answering', () => {
    expect(classifyDrift(answered({ source: 'origin', schema: CURRENT_SCHEMA }))).toBe('origin')
  })

  it('reports the recorded schema as stale', () => {
    expect(classifyDrift(answered({ source: 'origin', schema: RECORDED_SCHEMA }))).toBe('stale')
  })

  it('reports a body with no schema as the origin, rather than guessing', () => {
    expect(classifyDrift(answered({ source: 'origin' }))).toBe('origin')
  })

  it('does not call a schema from the future stale', () => {
    // Only older counts. A newer one means the origin moved on and this
    // module did not, which is a different failure and belongs in
    // `har.test.ts`, where the two versions are compared directly.
    expect(classifyDrift(answered({ source: 'origin', schema: CURRENT_SCHEMA + 1 }))).toBe('origin')
  })

  it('leaves a stub a stub, whatever schema it claims', () => {
    expect(classifyDrift(answered({ source: 'stub', schema: RECORDED_SCHEMA }))).toBe('stub')
  })

  it('leaves a refused request failed', () => {
    expect(classifyDrift(refused)).toBe('failed')
  })
})

describe('classifyEcho', () => {
  const words = { sent: 'live', recorded: 'recorded' }

  it('recognises the word that was sent', () => {
    expect(classifyEcho(answered({ source: 'origin', echoed: 'LIVE' }), words)).toBe('echoes-sent')
  })

  it('recognises the word the recording holds', () => {
    expect(classifyEcho(answered({ source: 'origin', echoed: 'RECORDED' }), words)).toBe(
      'echoes-recorded',
    )
  })

  it('reports a third word as failed rather than inventing an outcome for it', () => {
    expect(classifyEcho(answered({ source: 'origin', echoed: 'SOMETHING' }), words)).toBe('failed')
  })

  it('reports a stub as a stub without looking at the word', () => {
    expect(classifyEcho(answered({ source: 'stub', echoed: 'STUBBED' }), words)).toBe('stub')
  })

  it('compares against the words it is given rather than a constant', () => {
    // The point of passing them in: change the word the spec posts and the
    // classifier follows it, instead of agreeing with an old recording.
    expect(
      classifyEcho(answered({ source: 'origin', echoed: 'ADA' }), { sent: 'ada', recorded: 'x' }),
    ).toBe('echoes-sent')
  })
})

describe('echoedWord', () => {
  it('reads a string back', () => {
    expect(echoedWord({ echoed: 'LIVE' })).toBe('LIVE')
  })

  it('returns null when the field is absent or not a string', () => {
    expect(echoedWord({})).toBeNull()
    expect(echoedWord({ echoed: 7 })).toBeNull()
    expect(echoedWord(null)).toBeNull()
  })
})

describe('classifyRetry', () => {
  it('reports a success on the second attempt as a recovery', () => {
    expect(classifyRetry(attempts(answered({ source: 'origin' }), 2))).toBe('recovered')
  })

  it('reports a success on the first attempt as the retry never running', () => {
    expect(classifyRetry(attempts(answered({ source: 'origin' }), 1))).toBe('first-try')
  })

  it('reports two attempts that both failed as failed', () => {
    expect(classifyRetry(attempts(answered({ source: 'origin' }, 503), 2))).toBe('failed')
  })

  it('reports a refused request as failed whatever the attempt count says', () => {
    expect(classifyRetry(attempts(refused, 2))).toBe('failed')
  })
})

describe('classifyStylesheet', () => {
  it('reads the fixture colour as the stylesheet having arrived', () => {
    expect(classifyStylesheet(STYLED_COLOUR)).toBe('origin')
  })

  it('reads the user-agent default as the stylesheet having been blocked', () => {
    expect(classifyStylesheet('rgb(0, 0, 0)')).toBe('failed')
  })

  it('reads an empty string — no such element — as failed', () => {
    expect(classifyStylesheet('')).toBe('failed')
  })
})

describe('classifyReach', () => {
  it('finds a GET of the exact path in the ledger', () => {
    expect(classifyReach(['GET /api/profile'], '/api/profile')).toBe('reached')
  })

  it('does not count a cache-busted request as the same request', () => {
    // The probe asks about one request. A wiring that served the plain GET
    // from a recording and let the cache-busted one through has not reached
    // the origin with the request being asked about.
    expect(classifyReach(['GET /api/profile?cb=7'], '/api/profile')).toBe('not-reached')
  })

  it('does not count a POST to the same path', () => {
    expect(classifyReach(['POST /api/profile'], '/api/profile')).toBe('not-reached')
  })

  it('reports an empty ledger as not reached', () => {
    expect(classifyReach([], '/api/profile')).toBe('not-reached')
  })
})
