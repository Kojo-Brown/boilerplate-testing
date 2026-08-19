/**
 * **Mock** — the expectation is set before the act, and the double enforces it.
 *
 * A mock is handed the complete script of the conversation it expects, in
 * order, and fails the moment reality departs from it — including on calls
 * nobody wrote an assertion about. Where a spy answers "did this happen?", a
 * mock asserts "this, exactly this, and nothing else happened."
 *
 * Two properties follow, and both are trade-offs rather than features:
 *
 *  1. It catches calls you never thought to forbid. That is how it sees the
 *     `NUDGES_AT_REGISTRATION` fault in `faults.ts`, which the spy sails past.
 *  2. It fails on interactions that are merely *different*, not wrong. Add a
 *     second, harmless email to the registration flow and every mock-based
 *     test breaks. Over-specification is the standing cost of this kind, and
 *     it is why a suite made entirely of mocks calcifies.
 *
 * Failures surface at the moment of the deviation, from inside the system
 * under test, which is a better stack trace than a spy's end-of-test
 * comparison — but a system that catches its own exceptions would swallow it.
 * So the failure is also recorded and re-thrown by `verify()`, and a
 * mock-based test must always call `verify()`, both to flush a swallowed
 * failure and to catch the calls that never came.
 */

import type { Mailer, Plan, WelcomeDetails } from './registerUser'

export type ExpectedCall =
  | { readonly method: 'sendWelcome'; readonly email: string; readonly plan: Plan }
  | { readonly method: 'sendUpgradeNudge'; readonly email: string }

function describeCall(call: ExpectedCall): string {
  return call.method === 'sendWelcome'
    ? `sendWelcome(${call.email}, { plan: '${call.plan}' })`
    : `sendUpgradeNudge(${call.email})`
}

function sameCall(a: ExpectedCall, b: ExpectedCall): boolean {
  if (a.method !== b.method) return false
  if (a.method === 'sendWelcome' && b.method === 'sendWelcome') {
    return a.email === b.email && a.plan === b.plan
  }
  return a.email === b.email
}

export class MockMailer implements Mailer {
  private readonly expected: readonly ExpectedCall[]
  private received = 0
  private failure: Error | null = null

  constructor(expected: readonly ExpectedCall[]) {
    this.expected = [...expected]
  }

  async sendWelcome(email: string, details: WelcomeDetails): Promise<void> {
    this.accept({ method: 'sendWelcome', email, plan: details.plan })
  }

  async sendUpgradeNudge(email: string): Promise<void> {
    this.accept({ method: 'sendUpgradeNudge', email })
  }

  /** Throws if every expected call arrived but one or more are still missing. */
  verify(): void {
    if (this.failure !== null) throw this.failure

    const missing = this.expected.slice(this.received)
    if (missing.length > 0) {
      throw new Error(
        `MockMailer: expected call${missing.length === 1 ? '' : 's'} never arrived — ` +
          missing.map(describeCall).join(', '),
      )
    }
  }

  private accept(actual: ExpectedCall): void {
    const next = this.expected[this.received]
    this.received += 1

    if (next === undefined) {
      throw this.fail(`MockMailer: unexpected call ${describeCall(actual)} — none was expected here`)
    }

    if (!sameCall(next, actual)) {
      throw this.fail(
        `MockMailer: expected ${describeCall(next)} but got ${describeCall(actual)}`,
      )
    }
  }

  private fail(message: string): Error {
    const error = new Error(message)
    // Remember the first deviation: if the system under test swallows this
    // exception, `verify()` is the only thing left that can report it.
    this.failure ??= error
    return error
  }
}
