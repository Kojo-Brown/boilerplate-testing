// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { CaseSensitiveUserStore, InMemoryUserStore } from './fake'
import { fakeProbe } from './probes'
import { createRegisterUser } from './registerUser'
import { runUserStoreContract, USER_STORE_CONTRACT } from './userStoreContract'

describe('fake', () => {
  it('lets the feature be tested through state rather than through calls', async () => {
    await fakeProbe(createRegisterUser)
  })

  describe('the store contract', () => {
    // The suite a production adapter would have to pass, run against the
    // in-memory one. Without this, the fake is unreviewed code that every
    // other test in the folder is trusting.
    for (const behaviour of USER_STORE_CONTRACT) {
      it(behaviour.name, async () => {
        await behaviour.check(new InMemoryUserStore())
      })
    }
  })

  it('has teeth: a store that drifts from the real one fails the contract', async () => {
    // `CaseSensitiveUserStore` differs from the good fake in one rule, of the
    // kind that produces no error anywhere — it simply decides that
    // `ALICE@example.com` is a new customer. This is the failure mode that
    // makes fakes the most expensive double to own, and the only defence is
    // the contract above being able to catch it.
    const failed = await runUserStoreContract(() => new CaseSensitiveUserStore())

    expect(failed).toEqual(['matches addresses case-insensitively, because mailboxes do'])
  })
})
