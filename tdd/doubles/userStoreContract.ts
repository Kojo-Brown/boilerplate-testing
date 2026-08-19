/**
 * The behaviour every `UserStore` implementation owes its callers.
 *
 * This file exists because of the one obligation that separates a fake from
 * the other four kinds of double: a fake is a *working implementation*, so it
 * can be wrong in the way implementations are wrong — subtly, silently, and in
 * a direction that makes every test using it pass. A stub that returns the
 * wrong canned answer is visible in the test that set it up; an in-memory
 * store that quietly treats `Alice@example.com` and `alice@example.com` as two
 * different people is visible nowhere until production says otherwise.
 *
 * The defence is to specify the store once and run that specification against
 * every implementation of it — the fake here, and the Prisma or Postgres
 * adapter wherever it lives in a real codebase. The behaviours below are
 * plain async functions rather than `it()` blocks so they can be used both
 * ways: registered as a suite (`fake.test.ts`) and executed programmatically
 * to prove the contract actually fails a store that drifts.
 */

import { expect } from 'vitest'

import type { RegisteredUser, UserStore } from './registerUser'

export type UserStoreFactory = () => UserStore

export type StoreBehaviour = {
  readonly name: string
  readonly check: (store: UserStore) => Promise<void>
}

const ALICE: RegisteredUser = { email: 'alice@example.com', plan: 'team', seatLimit: 25 }

export const USER_STORE_CONTRACT: readonly StoreBehaviour[] = [
  {
    name: 'reports an unknown address as absent rather than throwing',
    check: async (store) => {
      expect(await store.findByEmail('nobody@example.com')).toBeNull()
    },
  },
  {
    name: 'returns a saved user',
    check: async (store) => {
      await store.save(ALICE)

      expect(await store.findByEmail(ALICE.email)).toEqual(ALICE)
    },
  },
  {
    name: 'matches addresses case-insensitively, because mailboxes do',
    check: async (store) => {
      await store.save(ALICE)

      expect(await store.findByEmail('ALICE@Example.com')).toEqual(ALICE)
    },
  },
  {
    name: 'keeps saved users independent of the object the caller passed',
    check: async (store) => {
      const mutable = { ...ALICE }
      await store.save(mutable)
      Object.assign(mutable, { plan: 'enterprise' })

      // A store that held a reference to the caller's object would hand back
      // `enterprise` here — a class of bug real adapters cannot have (they
      // serialise) and in-memory fakes have by default.
      expect(await store.findByEmail(ALICE.email)).toEqual(ALICE)
    },
  },
  {
    name: 'overwrites rather than duplicates when the same address is saved twice',
    check: async (store) => {
      await store.save(ALICE)
      await store.save({ ...ALICE, plan: 'enterprise', seatLimit: 200 })

      const found = await store.findByEmail(ALICE.email)

      expect(found).toEqual({ ...ALICE, plan: 'enterprise', seatLimit: 200 })
    },
  },
]

/**
 * Runs the whole contract against a store and reports which behaviours failed.
 *
 * Used by `fake.test.ts` to demonstrate — as a passing test — that the
 * contract has teeth: a store that drops case-insensitivity is handed to this
 * function and the failure is asserted, rather than described in a comment.
 */
export async function runUserStoreContract(create: UserStoreFactory): Promise<string[]> {
  const failed: string[] = []

  for (const behaviour of USER_STORE_CONTRACT) {
    try {
      await behaviour.check(create())
    } catch {
      failed.push(behaviour.name)
    }
  }

  return failed
}
