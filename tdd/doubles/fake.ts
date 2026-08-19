/**
 * **Fake** — a working implementation with a shortcut inside.
 *
 * A fake behaves like the real collaborator: it enforces the same rules, it
 * remembers what you did to it, and you can drive a whole feature through it
 * without teaching it anything about the test at hand. What makes it a double
 * is only *how* it works — a `Map` instead of Postgres, a folder instead of
 * S3, an array instead of a queue.
 *
 * That is its strength and its liability. Strength: tests written against a
 * fake assert on state, read like the feature rather than like its wiring, and
 * survive refactors that reshuffle the calls underneath. Liability: it is code
 * with no tests of its own unless you write them, and a fake that has drifted
 * from the real thing makes every suite that uses it confidently wrong. So the
 * fake here is held to `userStoreContract.ts`, the same suite a production
 * adapter would have to pass.
 */

import type { RegisteredUser, UserStore } from './registerUser'

/** Mailboxes are matched case-insensitively; the local part's case is kept. */
function key(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The fake: a real user store backed by a `Map`.
 *
 * It is a fake and not a stub because nothing here was arranged for a
 * particular test — save then find, and it answers correctly for any input,
 * including ones no test has thought of.
 */
export class InMemoryUserStore implements UserStore {
  private readonly byEmail = new Map<string, RegisteredUser>()

  async findByEmail(email: string): Promise<RegisteredUser | null> {
    return this.byEmail.get(key(email)) ?? null
  }

  async save(user: RegisteredUser): Promise<void> {
    // Copy on the way in. A real adapter serialises, so it cannot alias the
    // caller's object; an in-memory one has to be told not to.
    this.byEmail.set(key(user.email), { ...user })
  }

  /**
   * Test-only window onto the state, sorted for stable assertions.
   *
   * Not part of `UserStore`: the feature must never be able to reach it, or
   * the fake stops being a substitute for the real thing.
   */
  snapshot(): readonly RegisteredUser[] {
    return [...this.byEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
  }
}

/**
 * The same fake with one rule dropped: addresses are matched exactly.
 *
 * This is what fake drift looks like — no error, no crash, just a store that
 * says `ALICE@example.com` is a stranger. It exists so `fake.test.ts` can show
 * the contract catching it, which is the only evidence that running the
 * contract against the good fake means anything.
 */
export class CaseSensitiveUserStore implements UserStore {
  private readonly byEmail = new Map<string, RegisteredUser>()

  async findByEmail(email: string): Promise<RegisteredUser | null> {
    return this.byEmail.get(email.trim()) ?? null
  }

  async save(user: RegisteredUser): Promise<void> {
    this.byEmail.set(user.email.trim(), { ...user })
  }
}
