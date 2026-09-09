/**
 * Provider states: the setup each interaction names in `given(...)`.
 *
 * A provider state is the one part of a pact the consumer cannot check. The
 * consumer writes `given('user with id 1 exists')` and gets a mock; whether
 * the provider can *reach* that state is asserted here and nowhere else. The
 * old verify template had all six of these as empty async functions with a
 * comment describing what they would do, which is worth naming precisely: an
 * empty state handler does not skip the interaction, it runs it against
 * whatever state the previous one left behind. Six empty handlers make a suite
 * that passes or fails on interaction ordering.
 *
 * Two rules hold every handler here honest, and `states.test.ts` checks both:
 *
 *   - Every state resets the store first. An interaction must not depend on
 *     the one before it, and pact makes no ordering promise.
 *   - {@link STATE_HANDLERS} covers exactly the states in the pact file, in
 *     both directions. A pact naming a state with no handler verifies against
 *     an empty database and fails somewhere unhelpful; a handler for a state
 *     no pact names is dead setup nobody will delete.
 */

import { MOCK_REFRESH_TOKEN, type UserStore } from './app'

/** Alice: the seeded user every read interaction expects to find. */
export const ALICE = {
  id: 1,
  email: 'alice@example.com',
  name: 'Alice',
  role: 'user',
  createdAt: '2024-01-01T00:00:00.000Z',
  // Obviously fake, and the same literal the consumer contract sends as its
  // example value. Not a credential: this store exists for the length of one
  // verification run and is never reachable from outside the test process.
  password: 'S3cure!Pass',
} as const

/** A second row, so `GET /v1/users` returns a list rather than a singleton. */
export const MOD = {
  id: 2,
  email: 'mod@example.com',
  name: 'Mod',
  role: 'moderator',
  createdAt: '2024-01-03T00:00:00.000Z',
  password: 'S3cure!Pass',
} as const

/** Parameters a consumer attached to `given(state, params)`. */
export type StateParams = Readonly<Record<string, unknown>>

/** A state handler: puts the store into the named state from empty. */
export type StateHandler = (store: UserStore, params: StateParams) => void

/**
 * Builds the handler table for a store.
 *
 * Returned as a plain record rather than a class so it can be handed straight
 * to `Verifier`'s `stateHandlers`, which is what the shape is for.
 *
 * The callback takes the state's *parameters* as its only argument — pact-js's
 * `StateFunc` is `(parameters?: AnyJson) => Promise<JsonMap | void>`, not the
 * `(setup, parameters)` pair the message-provider API uses. Getting that wrong
 * is silent: the handler still runs, `params` is the boolean `true`, and the
 * only symptom is an interaction failing on a value the state was supposed to
 * arrange.
 */
export function stateHandlers(store: UserStore): Record<string, StateSetup> {
  const table: Record<string, StateSetup> = {}
  for (const [state, handler] of Object.entries(STATE_HANDLERS)) {
    table[state] = async (params?: StateParams) => {
      store.reset()
      handler(store, params ?? {})
    }
  }
  return table
}

/** The callback shape `Verifier`'s `stateHandlers` map takes. */
export type StateSetup = (params?: StateParams) => Promise<void>

/**
 * Every provider state the two consumer suites name, and what it means.
 *
 * Keyed by the exact string in `given(...)`. `states.test.ts` reads the
 * generated pact and fails if these keys and the pact's states disagree in
 * either direction.
 */
export const STATE_HANDLERS: Readonly<Record<string, StateHandler>> = {
  'user with id 1 exists': (store) => {
    store.upsert(ALICE)
  },

  'users exist': (store) => {
    store.upsert(ALICE)
    store.upsert(MOD)
  },

  // A *negative* state. The handler that does nothing after a reset is
  // correct here and only here, and it is written as an explicit delete so
  // the difference between "this state needs no setup" and "somebody has not
  // filled this one in yet" is visible in the source.
  'no user with email bob@example.com exists': (store) => {
    store.deleteByEmail('bob@example.com')
  },

  'valid credentials for alice@example.com': (store) => {
    store.upsert(ALICE)
  },

  'no user with email unknown@example.com exists': (store) => {
    store.deleteByEmail('unknown@example.com')
  },

  // The one state that takes a parameter, and it took a failing verification
  // to find out it had to.
  //
  // Without one, "a valid refresh token exists" is unsatisfiable: the provider
  // seeds a token it invented, the verifier replays the consumer's example
  // value, and the two are different strings — so the interaction fails on a
  // 401 that looks like a provider bug and is a fixture mismatch. A regex
  // matcher on the field does not help, because the *provider* is the side
  // being matched against and the request body is replayed verbatim.
  //
  // `given('a valid refresh token exists', { refreshToken: … })` is the fix
  // pact provides for exactly this: the consumer states which token it will
  // present, and the provider makes that one valid. Falling back to the
  // provider's own token keeps the handler usable from `app.test.ts`, which
  // has no consumer to ask.
  'a valid refresh token exists': (store, params) => {
    store.upsert(ALICE)
    const token = params['refreshToken']
    store.issueRefreshToken(typeof token === 'string' ? token : MOCK_REFRESH_TOKEN)
  },
}
