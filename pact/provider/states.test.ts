/**
 * The states, checked against the pact rather than against a list.
 *
 * The failure this file exists to prevent is silent: a consumer adds an
 * interaction with a new `given(...)`, the provider has no handler for it, and
 * the verifier runs that interaction against whatever the previous one left in
 * the store. Sometimes it passes. When it fails, it fails on a value rather
 * than on the missing setup, and the reader goes looking at the wrong file.
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONSUMER_PACT_FILE } from '../pact.config'
import { UserStore } from './app'
import { stateHandlers, STATE_HANDLERS } from './states'

interface PactShape {
  interactions: { providerStates?: { name: string; params?: Record<string, unknown> }[] }[]
}

/** Every state named by the pact the consumer suites wrote. */
function statesInPact(): string[] {
  expect(
    existsSync(CONSUMER_PACT_FILE),
    `No pact at ${CONSUMER_PACT_FILE} — run \`pnpm pact:consumer\` first`,
  ).toBe(true)
  const pact = JSON.parse(readFileSync(CONSUMER_PACT_FILE, 'utf8')) as PactShape
  return [
    ...new Set(
      pact.interactions.flatMap((interaction) =>
        (interaction.providerStates ?? []).map((state) => state.name),
      ),
    ),
  ].sort()
}

describe('Provider states', () => {
  it('covers exactly the states the pact names', () => {
    expect(Object.keys(STATE_HANDLERS).sort()).toEqual(statesInPact())
  })

  it('reaches every state from an empty store', async () => {
    for (const [state, setup] of Object.entries(stateHandlers(new UserStore()))) {
      await expect(setup({}), `state ${JSON.stringify(state)} threw`).resolves.toBeUndefined()
    }
  })

  it('discards what an earlier state left behind', async () => {
    const store = new UserStore()
    const handlers = stateHandlers(store)

    await handlers['users exist']!({})
    expect(store.all()).toHaveLength(2)

    await handlers['user with id 1 exists']!({})
    expect(store.all().map((user) => user.id)).toEqual([1])
  })

  it('makes the token the consumer names valid, not the provider’s own', async () => {
    const store = new UserStore()
    const handlers = stateHandlers(store)
    await handlers['a valid refresh token exists']!({ refreshToken: 'mock-consumer-token' })

    expect(store.hasRefreshToken('mock-consumer-token')).toBe(true)
  })

  it('falls back to the provider’s token when the state carries no parameter', async () => {
    const store = new UserStore()
    await stateHandlers(store)['a valid refresh token exists']!({})
    // The fallback exists so the handler is usable without a consumer; what it
    // must not do is leave *no* valid token, which is a 401 that reads as a
    // provider bug.
    expect(store.hasRefreshToken('mock-consumer-token')).toBe(false)
    expect(store.all()).toHaveLength(1)
  })

  it('leaves the negative states empty', async () => {
    const store = new UserStore()
    const handlers = stateHandlers(store)
    await handlers['no user with email bob@example.com exists']!({})
    expect(store.byEmail('bob@example.com')).toBeUndefined()
  })
})
