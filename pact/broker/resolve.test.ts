/**
 * How a broker is resolved, and — more importantly — what is said when there
 * is not one.
 *
 * A suite that skips itself is a suite that can stop testing anything without
 * anybody noticing, so the reason is part of the contract here: the message has
 * to name the variable and say what to do about it, or the skip is
 * indistinguishable from a suite that never ran.
 */

import { describe, expect, it } from 'vitest'
import { authFromEnv, brokerFromEnv, BROKER_ENV, resolveBroker } from './resolve'

describe('Credentials from the environment', () => {
  it('reads nothing when nothing is set', () => {
    expect(authFromEnv({})).toEqual({ kind: 'none' })
  })

  it('reads a username and password pair', () => {
    expect(
      authFromEnv({
        [BROKER_ENV.username]: 'mock-user',
        [BROKER_ENV.password]: 'mock-password',
      }),
    ).toEqual({ kind: 'basic', username: 'mock-user', password: 'mock-password' })
  })

  it('ignores a username with no password', () => {
    expect(authFromEnv({ [BROKER_ENV.username]: 'mock-user' })).toEqual({ kind: 'none' })
  })

  it('prefers a token over a pair', () => {
    expect(
      authFromEnv({
        [BROKER_ENV.token]: 'mock-broker-token',
        [BROKER_ENV.username]: 'mock-user',
        [BROKER_ENV.password]: 'mock-password',
      }),
    ).toEqual({ kind: 'bearer', token: 'mock-broker-token' })
  })
})

describe('Resolving without contacting the broker', () => {
  it('names the missing variable and how to get one', () => {
    const resolution = brokerFromEnv({})
    expect(resolution.kind).toBe('unavailable')
    if (resolution.kind === 'unavailable') {
      expect(resolution.reason).toContain(BROKER_ENV.baseUrl)
      expect(resolution.reason).toContain('pactfoundation/pact-broker')
    }
  })

  it('builds a client carrying the configured credentials', () => {
    const resolution = brokerFromEnv({
      [BROKER_ENV.baseUrl]: 'http://broker.invalid',
      [BROKER_ENV.token]: 'mock-broker-token',
    })
    expect(resolution.kind).toBe('available')
    if (resolution.kind === 'available') {
      expect(resolution.client.baseUrl).toBe('http://broker.invalid')
      expect(resolution.client.auth).toEqual({ kind: 'bearer', token: 'mock-broker-token' })
    }
  })
})

describe('Resolving against a broker that is not up', () => {
  it('reports the URL it tried rather than a connection error', async () => {
    const resolution = await resolveBroker({ [BROKER_ENV.baseUrl]: 'http://127.0.0.1:9' })
    expect(resolution.kind).toBe('unavailable')
    if (resolution.kind === 'unavailable') {
      expect(resolution.reason).toContain('http://127.0.0.1:9')
      expect(resolution.reason).toContain('heartbeat')
    }
  })
})
