// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { faultNamed } from './faults'
import { spyProbe } from './probes'
import { createRegisterUser } from './registerUser'
import { SpyMailer } from './spy'
import { buildWorld } from './world'

const NUDGES = faultNamed('NUDGES_AT_REGISTRATION')

const ALICE = { email: 'alice@example.com', plan: 'team', actor: { kind: 'self' } } as const

describe('spy', () => {
  it('records the welcome email and lets the test judge it afterwards', async () => {
    await spyProbe(createRegisterUser)
  })

  it('says nothing about the calls the test did not ask about', async () => {
    // The system sends an unasked-for second email. The spy dutifully records
    // it — the information is right there — and the probe passes anyway,
    // because it only ever looked at `welcomes`. A spy is exactly as strict as
    // the assertions written against it, which is the trade `mock.test.ts`
    // takes the other side of.
    const mailer = new SpyMailer()
    const registerUser = NUDGES.build(buildWorld({ mailer }))

    await registerUser(ALICE)

    expect(mailer.welcomes).toEqual([{ email: 'alice@example.com', plan: 'team' }])
    expect(mailer.nudges).toEqual(['alice@example.com'])
  })

  it('catches the same bug the moment somebody asserts the silence', async () => {
    const mailer = new SpyMailer()
    const registerUser = NUDGES.build(buildWorld({ mailer }))

    await registerUser(ALICE)

    // The fix is one line, and the point is that it has to be written. Assert
    // the absence of the calls that would be wrong, or accept that they are
    // invisible.
    expect(() => expect(mailer.nudges).toEqual([])).toThrow()
  })
})
