import { describe, expect, it } from 'vitest'

import {
  ambientEnvironment,
  createDeterministicEnvironment,
  createManualClock,
  createManualScheduler,
  DEFAULT_SEED,
  EPOCH,
  MONOTONIC_ORIGIN,
} from './environment.ts'

describe('the manual clock', () => {
  it('starts at the epoch every deterministic environment shares', () => {
    expect(createManualClock().now()).toBe(EPOCH)
    expect(createManualClock().elapsed()).toBe(MONOTONIC_ORIGIN)
  })

  it('moves wall and monotonic time together when time passes', () => {
    const clock = createManualClock()

    clock.advance(750)

    expect(clock.now()).toBe(EPOCH + 750)
    expect(clock.elapsed()).toBe(MONOTONIC_ORIGIN + 750)
  })

  it('moves the wall clock alone under a skew, which is what NTP does', () => {
    const clock = createManualClock()

    clock.skew(5_000)

    expect(clock.now()).toBe(EPOCH + 5_000)
    expect(clock.elapsed()).toBe(MONOTONIC_ORIGIN)
  })

  it('accepts a backwards skew, because a real correction can go either way', () => {
    const clock = createManualClock()

    clock.skew(-3_600_000)

    expect(clock.now()).toBe(EPOCH - 3_600_000)
    expect(clock.elapsed()).toBe(MONOTONIC_ORIGIN)
  })
})

describe('the manual scheduler', () => {
  it('runs nothing until time is asked to pass', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    let ran = false

    scheduler.schedule(() => {
      ran = true
    }, 10)

    expect(ran).toBe(false)
    expect(scheduler.pending()).toBe(1)
  })

  it('runs a callback once its delay has elapsed', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    let ran = false

    scheduler.schedule(() => {
      ran = true
    }, 10)
    scheduler.tick(10)

    expect(ran).toBe(true)
    expect(scheduler.pending()).toBe(0)
  })

  it('leaves a callback pending when the tick stops short of its delay', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    let ran = false

    scheduler.schedule(() => {
      ran = true
    }, 10)
    scheduler.tick(9)

    expect(ran).toBe(false)
    expect(scheduler.pending()).toBe(1)
  })

  // The property `probes.ts` leans on: a callback must observe the clock at
  // its own due time, not at the end of the window it was drained in.
  // Draining first and advancing afterwards would report the right instant for
  // every callback however wrong its delay was.
  it('puts the clock at a callback due time before running it', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    const observed: number[] = []

    scheduler.schedule(() => observed.push(clock.now()), 5)
    scheduler.schedule(() => observed.push(clock.now()), 25)
    scheduler.tick(100)

    expect(observed).toEqual([EPOCH + 5, EPOCH + 25])
    expect(clock.now()).toBe(EPOCH + 100)
  })

  it('runs callbacks due at the same instant in the order they were scheduled', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    const order: string[] = []

    scheduler.schedule(() => order.push('first'), 10)
    scheduler.schedule(() => order.push('second'), 10)
    scheduler.tick(10)

    expect(order).toEqual(['first', 'second'])
  })

  it('runs a callback scheduled from inside another one, when it is due in the same window', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    const order: string[] = []

    scheduler.schedule(() => {
      order.push('outer')
      scheduler.schedule(() => order.push('inner'), 5)
    }, 10)
    scheduler.tick(50)

    expect(order).toEqual(['outer', 'inner'])
  })

  it('skips a cancelled callback and stops counting it as pending', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    let ran = false

    const cancel = scheduler.schedule(() => {
      ran = true
    }, 10)

    cancel()

    expect(scheduler.pending()).toBe(0)

    scheduler.tick(100)

    expect(ran).toBe(false)
  })

  // A negative delay is not an error for `setTimeout` either. Throwing here
  // would turn `JITTER_NOT_CLAMPED` into a crash rather than the early refresh
  // it actually is, and the matrix would credit every probe with catching it
  // for the wrong reason.
  it('treats a negative delay as due immediately, as setTimeout does', () => {
    const clock = createManualClock()
    const scheduler = createManualScheduler(clock)

    const observed: number[] = []

    scheduler.schedule(() => observed.push(clock.now()), -500)
    scheduler.tick(1)

    expect(observed).toEqual([EPOCH])
  })
})

describe('the deterministic environment', () => {
  it('hands out the scripted draws before falling back to its seeded stream', () => {
    const env = createDeterministicEnvironment({ draws: [0.1, 0.9] })

    expect(env.random()).toBe(0.1)
    expect(env.random()).toBe(0.9)
    expect(env.random()).not.toBe(0.9)
  })

  it('produces the same stream twice from the same seed', () => {
    const first = createDeterministicEnvironment({ seed: 99 })
    const second = createDeterministicEnvironment({ seed: 99 })

    const draw = (): number[] => Array.from({ length: 8 }, () => first.random())
    const again = (): number[] => Array.from({ length: 8 }, () => second.random())

    expect(draw()).toEqual(again())
  })

  it('produces different streams from different seeds', () => {
    const first = createDeterministicEnvironment({ seed: DEFAULT_SEED })
    const second = createDeterministicEnvironment({ seed: DEFAULT_SEED + 1 })

    expect(first.random()).not.toBe(second.random())
  })

  // Readable rather than seeded-random, and a counter rather than a draw: a
  // draw can repeat, so a "unique" id built from one is only probably unique,
  // which is the property under test in the first place.
  it('names sessions in issue order so a failure prints something readable', () => {
    const env = createDeterministicEnvironment()

    expect([env.uuid(), env.uuid(), env.uuid()]).toEqual(['session-0', 'session-1', 'session-2'])
    expect(env.issued()).toBe(3)
  })

  it('shares one clock between its readings and its scheduler', () => {
    const env = createDeterministicEnvironment()

    let observed = 0

    env.schedule(() => {
      observed = env.now()
    }, 40)
    env.scheduler.tick(40)

    expect(observed).toBe(EPOCH + 40)
    expect(env.elapsed()).toBe(MONOTONIC_ORIGIN + 40)
  })
})

describe('the ambient environment', () => {
  // Captured references would defeat `vi.useFakeTimers()`, which replaces the
  // globals after this module has already been imported. `fidelity.test.ts`
  // checks the consequence; this checks the mechanism.
  it('reads its globals at call time rather than capturing them at import', () => {
    const original = Date.now

    try {
      Date.now = () => 4_242
      expect(ambientEnvironment.now()).toBe(4_242)
    } finally {
      Date.now = original
    }
  })

  it('produces a distinct identifier on every call', () => {
    const ids = new Set(Array.from({ length: 32 }, () => ambientEnvironment.uuid()))

    expect(ids.size).toBe(32)
  })

  it('cancels a scheduled callback', async () => {
    let ran = false

    const cancel = ambientEnvironment.schedule(() => {
      ran = true
    }, 1)

    cancel()

    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })

    expect(ran).toBe(false)
  })
})
