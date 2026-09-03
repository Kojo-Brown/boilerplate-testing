import { afterEach, describe, expect, it, vi } from 'vitest'

import { ambientEnvironment, EPOCH } from './environment.ts'
import { issue, isExpired, scheduleRefresh, timed, TTL_MS } from './session.ts'
import { worldNamed } from './worlds.ts'

// Everything in `worlds.ts` that claims to be `vi.useFakeTimers()` is a model,
// and a model nobody checks is a comment. This file is the check: the real
// tool, driving the real `ambientEnvironment`, asked the questions the model's
// shape depends on.
//
// The load-bearing one is the last group. `worlds.ts` gives the fake-timer
// worlds no `skew`, and `contract.ts` therefore withholds
// `duration-comes-from-the-monotonic-clock` from them, which is where two of
// the six cells in the headline result come from. That is a claim about
// Vitest, not about this repository, and it is asserted here rather than
// assumed: if fake timers ever gain a way to move the wall clock alone, this
// file goes red and the matrix is wrong.

afterEach(() => {
  vi.useRealTimers()
})

describe('fake timers reaching the ambient environment', () => {
  it('freezes the wall clock at the instant it was given', () => {
    vi.useFakeTimers({ now: EPOCH })

    expect(ambientEnvironment.now()).toBe(EPOCH)
    expect(ambientEnvironment.now()).toBe(EPOCH)
  })

  it('moves the wall clock by exactly the time advanced', () => {
    vi.useFakeTimers({ now: EPOCH })
    vi.advanceTimersByTime(1_234)

    expect(ambientEnvironment.now()).toBe(EPOCH + 1_234)
  })

  it('holds a scheduled callback until the timers are advanced', () => {
    vi.useFakeTimers({ now: EPOCH })

    let ran = false

    ambientEnvironment.schedule(() => {
      ran = true
    }, 50)

    expect(ran).toBe(false)

    vi.advanceTimersByTime(50)

    expect(ran).toBe(true)
  })

  it('honours the canceller returned by the ambient scheduler', () => {
    vi.useFakeTimers({ now: EPOCH })

    let ran = false

    ambientEnvironment.schedule(() => {
      ran = true
    }, 50)()

    vi.advanceTimersByTime(500)

    expect(ran).toBe(false)
  })
})

describe('the subject under real fake timers', () => {
  it('reaches its expiry instant when the clock is advanced to it', () => {
    vi.useFakeTimers({ now: EPOCH })

    const session = issue(ambientEnvironment, 'user-1')

    expect(isExpired(ambientEnvironment, session)).toBe(false)

    vi.advanceTimersByTime(TTL_MS)

    expect(isExpired(ambientEnvironment, session)).toBe(true)
  })

  // A jittered delay is a float — 20.0527ms here — and no scheduler honours
  // one. Both the fake clock and Node's real one quantise to whole
  // milliseconds, so the callback lands on an integer instant next to the
  // delay rather than on it. The assertion is a bracket rather than an
  // equality for that reason, and it is where `EARLY_TOLERANCE_MS` in
  // `worlds.ts` comes from: a probe asserting a callback did not fire early
  // has to allow the millisecond the scheduler rounded away, or it reports a
  // fault every time the draw is fractional, which is every time.
  it('runs its refresh at the whole millisecond nearest the delay it reported', () => {
    vi.useFakeTimers({ now: EPOCH })

    const session = issue(ambientEnvironment, 'user-1')

    let firedAt: number | null = null

    const { delayMs } = scheduleRefresh(ambientEnvironment, session, () => {
      firedAt = ambientEnvironment.now()
    })

    vi.advanceTimersByTime(delayMs - 1)

    expect(firedAt).toBeNull()

    vi.advanceTimersByTime(1)

    expect(firedAt).toBeGreaterThanOrEqual(EPOCH + Math.floor(delayMs))
    expect(firedAt).toBeLessThanOrEqual(EPOCH + Math.ceil(delayMs))
  })
})

describe('what fake timers do to the two clocks', () => {
  // The measurement the whole `separable-clocks` capability rests on.
  it('advances the wall clock and the monotonic clock by the same amount', () => {
    vi.useFakeTimers({ now: EPOCH })

    const wallBefore = ambientEnvironment.now()
    const monotonicBefore = ambientEnvironment.elapsed()

    vi.advanceTimersByTime(500)

    expect(ambientEnvironment.now() - wallBefore).toBe(500)
    expect(ambientEnvironment.elapsed() - monotonicBefore).toBe(500)
  })

  // The consequence: the fault is invisible under fake timers however the
  // clock is driven, because there is no drive that separates the readings.
  it('leaves a wall-clock-based duration indistinguishable from a monotonic one', () => {
    vi.useFakeTimers({ now: EPOCH })

    const monotonic = timed(ambientEnvironment, () => {
      vi.advanceTimersByTime(300)

      return null
    }).durationMs

    const wall = ((): number => {
      const startedAt = ambientEnvironment.now()

      vi.advanceTimersByTime(300)

      return ambientEnvironment.now() - startedAt
    })()

    expect(monotonic).toBe(300)
    expect(wall).toBe(monotonic)
  })

  it('offers no way to move the wall clock without the monotonic one', () => {
    vi.useFakeTimers({ now: EPOCH })

    const monotonicBefore = ambientEnvironment.elapsed()

    // Every way the API offers of moving time. `setSystemTime` is the closest
    // thing to a skew there is — it repoints the wall clock without running
    // timers — and the assertion below is that even it does not separate the
    // readings in a way `timed` could observe, because it does not move the
    // monotonic clock *forwards* either: after it, both readings are as far
    // apart as they were, so a duration measured across it is still zero.
    vi.setSystemTime(EPOCH + 60_000)

    expect(ambientEnvironment.elapsed()).toBe(monotonicBefore)

    const duration = timed(ambientEnvironment, () => {
      vi.setSystemTime(EPOCH + 120_000)

      return null
    }).durationMs

    expect(duration).toBe(0)
  })
})

describe('the modelled fake-timer world', () => {
  const world = worldNamed('fake-timers')

  it('withholds the ability to skew, matching the tool it models', () => {
    expect(world.create().skew).toBeNull()
    expect(world.capabilities).not.toContain('separable-clocks')
  })

  it('reaches an exact instant, matching the tool it models', () => {
    const instance = world.create()
    const session = issue(instance.env, 'user-1')

    instance.setInstant?.(session.expiresAt)

    expect(instance.env.now()).toBe(session.expiresAt)
    expect(isExpired(instance.env, session)).toBe(true)
  })

  it('needs no grace, because a hand-drained queue owes nothing to the runtime', () => {
    expect(world.create().grace).toBe(0)
  })
})
