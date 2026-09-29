// @vitest-environment node
//
// Node rather than the jsdom default: this file binds a real port.

/**
 * The bound origin — the parts `origin.test.ts` cannot reach without a socket.
 *
 * Three of them, and each one is a way the isolation runs could fail quietly
 * rather than loudly:
 *
 *   - a parked barrier request must actually be held open, not answered
 *     immediately, or the rendezvous that orders two workers does nothing and
 *     `session-eviction` becomes a race;
 *   - it must be *released* when the other party arrives, which is the half a
 *     hand-rolled hold would get wrong;
 *   - a port setting that is nonsense must fail at the boundary with the
 *     variable's name in it, rather than binding something surprising.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { FIXTURE_PASSWORD, ORIGIN_PORT, SESSION_COOKIE } from './origin.ts'
import { portFromEnv, startOrigin, type RunningOrigin } from './server.ts'

let running: RunningOrigin | null = null

async function origin(): Promise<{ base: string; instance: RunningOrigin }> {
  running = await startOrigin(0)

  return { base: `http://127.0.0.1:${running.port}`, instance: running }
}

afterEach(async () => {
  await running?.close()
  running = null
})

describe('binding', () => {
  it('reports the port it actually bound when asked for any', async () => {
    const { instance } = await origin()

    expect(instance.port).toBeGreaterThan(0)
  })

  it('answers the sign-in route over a socket', async () => {
    const { base } = await origin()
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.test', password: FIXTURE_PASSWORD }),
    })

    expect(response.headers.get('set-cookie')).toContain(SESSION_COOKIE)
  })
})

describe('the barrier over a socket', () => {
  it('holds the first party open and releases both when the second arrives', async () => {
    const { base } = await origin()
    let firstSettled = false

    const first = fetch(`${base}/api/barrier?name=meet&parties=2`).then((response) => {
      firstSettled = true

      return response.status
    })

    // Give the request every chance to be answered early: a full round trip of
    // a *different* request against the same server is strictly more time than
    // an immediate answer would have needed.
    await fetch(`${base}/api/me`)
    expect(firstSettled).toBe(false)

    const second = fetch(`${base}/api/barrier?name=meet&parties=2`).then((r) => r.status)

    expect(await Promise.all([first, second])).toEqual([200, 200])
  })

  it('answers 400 when two parties disagree about the count', async () => {
    const { base } = await origin()

    // Parked for the rest of the test and cut off by `close()` in `afterEach`,
    // so its rejection is caught here rather than surfacing as an unhandled one
    // after the suite has moved on.
    const parked = fetch(`${base}/api/barrier?name=meet&parties=2`).catch(() => null)
    const response = await fetch(`${base}/api/barrier?name=meet&parties=3`)

    expect(response.status).toBe(400)
    void parked
  })
})

describe('reading the port from the environment', () => {
  it('falls back to the baked-in port when unset', () => {
    expect(portFromEnv(undefined)).toBe(ORIGIN_PORT)
  })

  it('accepts a port number', () => {
    expect(portFromEnv('8080')).toBe(8080)
  })

  it('accepts 0, which is how the isolation runs avoid a fixed port', () => {
    expect(portFromEnv('0')).toBe(0)
  })

  it('refuses a value that is not a port, naming the variable', () => {
    expect(() => portFromEnv('http://localhost')).toThrow(/AUTHSTATE_PORT/)
  })

  it('refuses a port above the range', () => {
    expect(() => portFromEnv('70000')).toThrow(/AUTHSTATE_PORT/)
  })
})
