/**
 * What "started" costs, and what it leaves out.
 *
 * Every assertion here is ordinal rather than absolute. The milliseconds in
 * `README.md` are from a named machine and are reported, not enforced — a gate
 * that fails because a CI runner was 40ms slower is a gate somebody disables.
 * What is enforced is the shape of the result, which is the part that is a
 * property of the modules rather than of the hardware: two of the three wait
 * strategies are honest, one is not, and the one that is not is Kafka's by a
 * factor of hundreds.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { STORE_NAMES, type StoreName } from './images.ts'
import { measureStartup, type Startup } from './readiness.ts'
import { renderStartup } from './report.ts'
import { awaitUsable } from './stores.ts'

const measured = new Map<StoreName, Startup>()

beforeAll(async () => {
  for (const store of STORE_NAMES) {
    const startup = await measureStartup(store, { reuse: false })

    measured.set(store, startup)
    console.info(renderStartup(startup))
  }
}, 600_000)

afterAll(async () => {
  await Promise.all([...measured.values()].map((startup) => startup.started.stop()))
  measured.clear()
})

const startupFor = (store: StoreName): Startup => {
  const startup = measured.get(store)

  if (startup === undefined) {
    throw new Error(`No startup was measured for ${store}`)
  }

  return startup
}

describe('a resolved start()', () => {
  it.each(['postgres', 'redis'] as const)('leaves %s ready for its first client', (store) => {
    const startup = startupFor(store)

    expect(startup.readiness.attempts).toBe(1)
  })

  it('leaves Kafka refusing connections for seconds', () => {
    const kafka = startupFor('kafka')

    // The mechanism is in `readiness.ts`: the module's post-script wait is
    // handed `undefined` and JavaScript's default-parameter rule substitutes
    // the substitute strategy, which was satisfied before the broker booted.
    expect(kafka.readiness.attempts).toBeGreaterThan(1)
    expect(kafka.readiness.elapsedMs).toBeGreaterThan(1_000)
  })

  it('accounts for less of the wait on Kafka than on either other store', () => {
    const share = (startup: Startup): number => startup.startMs / startup.totalMs

    expect(share(startupFor('kafka'))).toBeLessThan(share(startupFor('postgres')))
    expect(share(startupFor('kafka'))).toBeLessThan(share(startupFor('redis')))
  })
})

describe('awaitUsable', () => {
  it.each(STORE_NAMES)('answers on the first probe once %s has been reached once', async (store) => {
    const again = await awaitUsable(startupFor(store).started)

    expect(again.attempts).toBe(1)
  })

  it('reports the store it probed, so a failure names one', () => {
    for (const store of STORE_NAMES) {
      expect(startupFor(store).readiness.store).toBe(store)
    }
  })
})
