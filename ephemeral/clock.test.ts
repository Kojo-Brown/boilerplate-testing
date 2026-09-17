// @vitest-environment node
/**
 * The clock, which is three lines and still worth pinning.
 *
 * It is the only source of time in the directory, so a regression here would
 * turn the TTL rows into a coin flip rather than a failure — the sweep would
 * still run, it would simply decide something different, and the matrix would
 * go red somewhere else entirely.
 */

import { describe, expect, it } from 'vitest'

import { Clock, HOUR } from './clock.ts'

describe('the manual clock', () => {
  it('starts at zero', () => {
    expect(new Clock().now()).toBe(0)
  })

  it('moves only when a timeline advances it', () => {
    const clock = new Clock()

    clock.advance(30)
    clock.advance(15)

    expect(clock.now()).toBe(45)
  })

  it('reads correctly as a bare function, so it can be handed to the cloud', () => {
    const clock = new Clock()
    const read = clock.now

    clock.advance(HOUR)

    expect(read()).toBe(60)
  })

  it('refuses to go backwards, which is always a bug in a timeline', () => {
    expect(() => {
      new Clock().advance(-1)
    }).toThrow('cannot advance the clock')
  })
})
