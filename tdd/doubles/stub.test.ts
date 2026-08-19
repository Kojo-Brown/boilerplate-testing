// @vitest-environment node
import { describe, it, expect } from 'vitest'

import { stubProbe } from './probes'
import { createRegisterUser } from './registerUser'
import { DEFAULT_SEAT_LIMITS, StubSeatPolicy } from './stub'
import { buildWorld, expectRegistered } from './world'

describe('stub', () => {
  it('drives the seat limit into the result without asserting on the policy', async () => {
    await stubProbe(createRegisterUser)
  })

  it('answers the same way however often it is asked', async () => {
    // A stub has no memory and no script. This is the property that makes it
    // safe to share across a suite — and the property that makes it useless
    // for finding out whether the system asked once, twice, or not at all.
    const seats = new StubSeatPolicy()

    expect(await seats.seatLimitFor('team')).toBe(DEFAULT_SEAT_LIMITS.team)
    expect(await seats.seatLimitFor('team')).toBe(DEFAULT_SEAT_LIMITS.team)
  })

  it('is the knob the test turns: change the canned answer, change the outcome', async () => {
    const registerUser = createRegisterUser(
      buildWorld({ seats: new StubSeatPolicy({ free: 1, team: 3, enterprise: 4 }) }),
    )

    const user = expectRegistered(
      await registerUser({ email: 'alice@example.com', plan: 'team', actor: { kind: 'self' } }),
    )

    expect(user.seatLimit).toBe(3)
  })
})
