/**
 * The provider, on its own terms.
 *
 * `users.provider.pact.verify.test.ts` already asserts the thing that matters —
 * the provider satisfies the contract — so nothing here re-states that. What
 * this file is for is the property the whole `pipeline/` corpus rests on: each
 * flag changes exactly one observable behaviour, and `CORRECT` changes none.
 * Without it a "single-behaviour change" is a claim in a comment.
 */

import { describe, expect, it } from 'vitest'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CORRECT,
  MOCK_REFRESH_TOKEN,
  REQUIRED_SCOPE,
  serialiseUser,
  startProvider,
  UserStore,
  type ProviderFlags,
} from './app'
import { ALICE, MOD, STATE_HANDLERS } from './states'

const AUTH = { Authorization: 'Bearer mock-access-token' }

/** Every flag, so a new one cannot be added without appearing here. */
const FLAGS = Object.keys(CORRECT) as (keyof ProviderFlags)[]

function seeded(): UserStore {
  const store = new UserStore()
  store.upsert(ALICE)
  store.upsert(MOD)
  return store
}

describe('User serialisation', () => {
  it('emits the five fields the contract names, under the correct flags', () => {
    expect(serialiseUser(ALICE, CORRECT)).toEqual({
      id: 1,
      email: 'alice@example.com',
      name: 'Alice',
      role: 'user',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
  })

  // Every flag, including the three that change routing or a status code
  // rather than the body: those must change *nothing* here, which is as much
  // part of "single behaviour" as the ones that do.
  it.each(FLAGS)(
    'changes at most one thing about the user body under %s',
    (flag) => {
      const correct = serialiseUser(ALICE, CORRECT)
      const faulty = serialiseUser(ALICE, { ...CORRECT, [flag]: true })

      const keys = new Set([...Object.keys(correct), ...Object.keys(faulty)])
      const differing = [...keys].filter(
        (key) => JSON.stringify(correct[key]) !== JSON.stringify(faulty[key]),
      )

      // `snakeCaseCreatedAt` renames a key, which is two differing keys for
      // one behaviour — the old name gone and the new one present. Nothing
      // else may exceed one.
      expect(differing.length, `${flag} changed ${differing.join(', ')}`).toBeLessThanOrEqual(
        flag === 'snakeCaseCreatedAt' ? 2 : 1,
      )
    },
  )

  it('renames the timestamp key rather than adding a second one', () => {
    const body = serialiseUser(ALICE, { ...CORRECT, snakeCaseCreatedAt: true })
    expect(body).toHaveProperty('created_at')
    expect(body).not.toHaveProperty('createdAt')
  })

  it('coerces the id to a numeric string, not an arbitrary one', () => {
    expect(serialiseUser(ALICE, { ...CORRECT, stringifyUserId: true })['id']).toBe('1')
    expect(serialiseUser(ALICE, { ...CORRECT, bogusUserId: true })['id']).toBe('abc')
  })
})

describe('Provider HTTP surface', () => {
  it('refuses an unauthenticated read', async () => {
    const provider = await startProvider()
    try {
      const response = await fetch(`${provider.url}/v1/users/1`)
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ error: 'Unauthorized' })
    } finally {
      await provider.stop()
    }
  })

  it('answers a scope-gated read with 403 only under the flag', async () => {
    const provider = await startProvider({ ...CORRECT, requireScopeHeader: true })
    try {
      STATE_HANDLERS['user with id 1 exists']!(provider.store, {})
      const denied = await fetch(`${provider.url}/v1/users/1`, { headers: AUTH })
      expect(denied.status).toBe(403)

      const allowed = await fetch(`${provider.url}/v1/users/1`, {
        headers: { ...AUTH, 'X-Scope': REQUIRED_SCOPE },
      })
      expect(allowed.status).toBe(200)
    } finally {
      await provider.stop()
    }
  })

  it('creates a user and refuses a duplicate email', async () => {
    const provider = await startProvider()
    try {
      const body = JSON.stringify({
        email: 'bob@example.com',
        name: 'Bob',
        password: 'S3cure!Pass',
      })
      const headers = { ...AUTH, 'Content-Type': 'application/json' }

      const created = await fetch(`${provider.url}/v1/users`, { method: 'POST', headers, body })
      expect(created.status).toBe(201)
      expect(await created.json()).toMatchObject({ email: 'bob@example.com', role: 'user' })

      const duplicate = await fetch(`${provider.url}/v1/users`, { method: 'POST', headers, body })
      expect(duplicate.status).toBe(409)
    } finally {
      await provider.stop()
    }
  })

  it('stops routing logout under the flag and keeps refresh working', async () => {
    const provider = await startProvider({ ...CORRECT, removeLogoutRoute: true })
    try {
      provider.store.issueRefreshToken(MOCK_REFRESH_TOKEN)
      const headers = { 'Content-Type': 'application/json' }
      const body = JSON.stringify({ refreshToken: MOCK_REFRESH_TOKEN })

      const loggedOut = await fetch(`${provider.url}/v1/auth/logout`, {
        method: 'POST',
        headers,
        body,
      })
      expect(loggedOut.status).toBe(404)

      const refreshed = await fetch(`${provider.url}/v1/auth/refresh`, {
        method: 'POST',
        headers,
        body,
      })
      expect(refreshed.status).toBe(200)
      expect(await refreshed.json()).toMatchObject({ expiresIn: ACCESS_TOKEN_TTL_SECONDS })
    } finally {
      await provider.stop()
    }
  })
})

describe('User store', () => {
  it('orders the list by id', () => {
    expect(seeded().all().map((user) => user.id)).toEqual([1, 2])
  })

  it('forgets everything on reset', () => {
    const store = seeded()
    store.issueRefreshToken(MOCK_REFRESH_TOKEN)
    store.reset()
    expect(store.all()).toHaveLength(0)
    expect(store.hasRefreshToken(MOCK_REFRESH_TOKEN)).toBe(false)
  })

  it('assigns the next free id to an inserted user', () => {
    const store = seeded()
    expect(store.insert({ email: 'c@example.com', name: 'C', role: 'user', password: 'x' }).id).toBe(
      3,
    )
  })
})
