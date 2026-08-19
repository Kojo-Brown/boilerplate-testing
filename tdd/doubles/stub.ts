/**
 * **Stub** — canned answers, nothing else.
 *
 * A stub exists to feed the system under test an input it would otherwise
 * have to go and fetch. It has no memory worth inspecting and no opinion about
 * being called: the assertions in a stub-driven test are all about what the
 * system *returned* or *stored*, never about the stub.
 *
 * That is the line between a stub and a spy, and it is a line about the test,
 * not about the object. The moment a test asserts "the policy was consulted",
 * the same object is being used as a spy.
 *
 * The pressure to keep stubs dumb is real: a stub that grows an `if` on its
 * argument is a second implementation of the collaborator, living in test
 * code, that nobody will maintain. A lookup table is the ceiling; past that,
 * write a fake and give it a contract.
 */

import type { Plan, SeatPolicy } from './registerUser'

export type SeatTable = Readonly<Record<Plan, number>>

/**
 * The answers the inert world hands out.
 *
 * Three distinct values on purpose: a stub whose answers are all the same
 * cannot tell "asked the policy" apart from "guessed the number", which is
 * exactly the fault `IGNORES_SEAT_POLICY` injects in `faults.ts`.
 */
export const DEFAULT_SEAT_LIMITS: SeatTable = {
  free: 1,
  team: 25,
  enterprise: 200,
}

export class StubSeatPolicy implements SeatPolicy {
  private readonly limits: SeatTable

  constructor(limits: SeatTable = DEFAULT_SEAT_LIMITS) {
    this.limits = limits
  }

  async seatLimitFor(plan: Plan): Promise<number> {
    return this.limits[plan]
  }
}
