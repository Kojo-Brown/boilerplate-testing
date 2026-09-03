import { describe, expect, it } from 'vitest'

import { createDeterministicEnvironment, EPOCH, MONOTONIC_ORIGIN } from './environment.ts'
import {
  issue,
  isExpired,
  MAX_REFRESH_DELAY_MS,
  MIN_REFRESH_DELAY_MS,
  refreshDelayMs,
  renew,
  REFRESH_FRACTION,
  scheduleRefresh,
  timed,
  TTL_MS,
} from './session.ts'

// The subject's own suite, written in the world the measurement recommends:
// every source injected, every draw chosen. It is here to hold `session.ts`
// correct while the rest of the directory edits copies of it — a fault corpus
// is only meaningful against a subject somebody has actually specified.

describe('issuing a session', () => {
  it('stamps the issue instant from the wall clock', () => {
    const env = createDeterministicEnvironment()

    expect(issue(env, 'user-1').issuedAt).toBe(EPOCH)
  })

  it('expires one lifetime after the issue instant', () => {
    const env = createDeterministicEnvironment()
    const session = issue(env, 'user-1')

    expect(session.expiresAt).toBe(session.issuedAt + TTL_MS)
  })

  it('carries the user it was issued for', () => {
    expect(issue(createDeterministicEnvironment(), 'user-7').userId).toBe('user-7')
  })

  it('takes one identifier per session', () => {
    const env = createDeterministicEnvironment()

    expect([issue(env, 'user-1').id, issue(env, 'user-1').id]).toEqual(['session-0', 'session-1'])
  })
})

describe('expiry', () => {
  it('is not reached at the instant the session is issued', () => {
    const env = createDeterministicEnvironment()

    expect(isExpired(env, issue(env, 'user-1'))).toBe(false)
  })

  it('is not reached one millisecond before the expiry instant', () => {
    const env = createDeterministicEnvironment()
    const session = issue(env, 'user-1')

    env.clock.advance(TTL_MS - 1)

    expect(isExpired(env, session)).toBe(false)
  })

  // The half-open convention `property/availability.ts` argues for: the expiry
  // instant is the first instant the session is *not* valid.
  it('is reached at exactly the expiry instant', () => {
    const env = createDeterministicEnvironment()
    const session = issue(env, 'user-1')

    env.clock.advance(TTL_MS)

    expect(isExpired(env, session)).toBe(true)
  })

  it('is reached after the expiry instant', () => {
    const env = createDeterministicEnvironment()
    const session = issue(env, 'user-1')

    env.clock.advance(TTL_MS * 10)

    expect(isExpired(env, session)).toBe(true)
  })
})

describe('the refresh delay', () => {
  it('sits at half the lifetime on the midpoint draw', () => {
    const env = createDeterministicEnvironment({ draws: [0.5] })

    expect(refreshDelayMs(env)).toBe(TTL_MS * REFRESH_FRACTION)
  })

  it('moves earlier for a draw below the midpoint', () => {
    const env = createDeterministicEnvironment({ draws: [0.4] })

    expect(refreshDelayMs(env)).toBeLessThan(TTL_MS * REFRESH_FRACTION)
  })

  it('moves later for a draw above the midpoint', () => {
    const env = createDeterministicEnvironment({ draws: [0.6] })

    expect(refreshDelayMs(env)).toBeGreaterThan(TTL_MS * REFRESH_FRACTION)
  })

  it('clamps to the floor on the lowest draw', () => {
    const env = createDeterministicEnvironment({ draws: [0] })

    expect(refreshDelayMs(env)).toBe(MIN_REFRESH_DELAY_MS)
  })

  it('clamps to the ceiling on the highest draw', () => {
    const env = createDeterministicEnvironment({ draws: [0.999_999] })

    expect(refreshDelayMs(env)).toBe(MAX_REFRESH_DELAY_MS)
  })

  it('stays inside the band across the whole draw space', () => {
    const draws = Array.from({ length: 1_001 }, (_, index) => index / 1_001)
    const env = createDeterministicEnvironment({ draws })

    for (let index = 0; index < draws.length; index += 1) {
      const delay = refreshDelayMs(env)

      expect(delay).toBeGreaterThanOrEqual(MIN_REFRESH_DELAY_MS)
      expect(delay).toBeLessThanOrEqual(MAX_REFRESH_DELAY_MS)
    }
  })

  it('always leaves the refresh strictly inside the lifetime', () => {
    expect(MAX_REFRESH_DELAY_MS).toBeLessThan(TTL_MS)
  })
})

describe('scheduling a refresh', () => {
  it('reports the delay it used, so a caller can assert on it', () => {
    const env = createDeterministicEnvironment({ draws: [0.5] })
    const session = issue(env, 'user-1')

    expect(scheduleRefresh(env, session, () => {}).delayMs).toBe(TTL_MS * REFRESH_FRACTION)
  })

  it('runs the callback with the session, once the delay has passed', () => {
    const env = createDeterministicEnvironment({ draws: [0.5] })
    const session = issue(env, 'user-1')

    const refreshed: string[] = []

    scheduleRefresh(env, session, (value) => refreshed.push(value.id))
    env.scheduler.tick(TTL_MS)

    expect(refreshed).toEqual([session.id])
  })

  it('has not run the callback before the delay has passed', () => {
    const env = createDeterministicEnvironment({ draws: [0.5] })
    const session = issue(env, 'user-1')

    let ran = false

    const { delayMs } = scheduleRefresh(env, session, () => {
      ran = true
    })

    env.scheduler.tick(delayMs - 1)

    expect(ran).toBe(false)
  })

  it('stops the refresh when cancelled', () => {
    const env = createDeterministicEnvironment({ draws: [0.5] })
    const session = issue(env, 'user-1')

    let ran = false

    scheduleRefresh(env, session, () => {
      ran = true
    }).cancel()

    env.scheduler.tick(TTL_MS * 4)

    expect(ran).toBe(false)
  })
})

describe('renewal', () => {
  it('starts a full lifetime from the present instant', () => {
    const env = createDeterministicEnvironment()
    const original = issue(env, 'user-1')

    env.clock.advance(TTL_MS - 1)

    const renewed = renew(env, original)

    expect(renewed.issuedAt).toBe(EPOCH + TTL_MS - 1)
    expect(renewed.expiresAt).toBe(renewed.issuedAt + TTL_MS)
  })

  it('keeps the user and takes a new identifier', () => {
    const env = createDeterministicEnvironment()
    const original = issue(env, 'user-3')
    const renewed = renew(env, original)

    expect(renewed.userId).toBe('user-3')
    expect(renewed.id).not.toBe(original.id)
  })
})

describe('timing an operation', () => {
  it('returns whatever the operation returned', () => {
    expect(timed(createDeterministicEnvironment(), () => 'value').value).toBe('value')
  })

  it('reports the monotonic time the operation took', () => {
    const env = createDeterministicEnvironment()

    expect(
      timed(env, () => {
        env.clock.advance(120)

        return null
      }).durationMs,
    ).toBe(120)
  })

  // The behaviour no fake-timer library can check, because a fake clock moves
  // both readings together. A wall-clock jump under a running operation must
  // not appear as elapsed time.
  it('ignores a wall-clock jump underneath the operation', () => {
    const env = createDeterministicEnvironment()

    const { durationMs } = timed(env, () => {
      env.clock.skew(5_000)

      return null
    })

    expect(durationMs).toBe(0)
    expect(env.now()).toBe(EPOCH + 5_000)
    expect(env.elapsed()).toBe(MONOTONIC_ORIGIN)
  })

  it('ignores a backwards wall-clock correction just the same', () => {
    const env = createDeterministicEnvironment()

    expect(
      timed(env, () => {
        env.clock.skew(-5_000)

        return null
      }).durationMs,
    ).toBe(0)
  })
})
