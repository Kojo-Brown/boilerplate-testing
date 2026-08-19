// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { faultNamed } from './faults'
import { MockMailer } from './mock'
import { mockProbe } from './probes'
import { createRegisterUser } from './registerUser'
import { buildWorld } from './world'

const ALICE = { email: 'alice@example.com', plan: 'team', actor: { kind: 'self' } } as const

const WELCOME_ALICE = {
  method: 'sendWelcome',
  email: 'alice@example.com',
  plan: 'team',
} as const

describe('mock', () => {
  it('passes when the conversation is exactly the one that was expected', async () => {
    await mockProbe(createRegisterUser)
  })

  it('reports a call that never came, at verify time', async () => {
    const mailer = new MockMailer([WELCOME_ALICE])
    const registerUser = faultNamed('SILENT_WELCOME').build(buildWorld({ mailer }))

    await registerUser(ALICE)

    expect(() => mailer.verify()).toThrow(/never arrived/)
  })

  it('rejects an extra call the instant it is made, with no assertion written for it', async () => {
    // Nothing in this test mentions upgrade nudges. That is the whole point:
    // the expectation was "this conversation and no other", so a call nobody
    // anticipated is a failure without anybody anticipating it.
    const mailer = new MockMailer([WELCOME_ALICE])
    const registerUser = faultNamed('NUDGES_AT_REGISTRATION').build(buildWorld({ mailer }))

    await expect(registerUser(ALICE)).rejects.toThrow(/unexpected call/)
  })

  it('rejects the right call with the wrong arguments', async () => {
    const mailer = new MockMailer([{ ...WELCOME_ALICE, plan: 'enterprise' }])
    const registerUser = createRegisterUser(buildWorld({ mailer }))

    await expect(registerUser(ALICE)).rejects.toThrow(/expected sendWelcome/)
  })

  it('still reports a failure the system under test swallowed', async () => {
    // Mocks fail by throwing from inside the code being tested, so any
    // `try/catch` in that code can eat the failure and leave the test green.
    // `verify()` is the second line of defence, and the reason a mock-based
    // test that forgets to call it is not really using a mock.
    const mailer = new MockMailer([WELCOME_ALICE])
    const world = buildWorld({ mailer })
    const registerUser = createRegisterUser({
      ...world,
      mailer: {
        sendWelcome: async (email, details) => {
          try {
            await mailer.sendWelcome(email, { ...details, plan: 'enterprise' })
          } catch {
            // "retry later", says the comment in the real codebase
          }
        },
        sendUpgradeNudge: (email) => mailer.sendUpgradeNudge(email),
      },
    })

    const result = await registerUser(ALICE)

    expect(result.status).toBe('registered')
    expect(() => mailer.verify()).toThrow(/expected sendWelcome/)
  })
})
