/**
 * The inert world every probe starts from.
 *
 * Each of the five probes in `probes.ts` is interested in exactly one seam. It
 * still has to supply the other three, because the use case will not run
 * without them — that is simply what it costs to test a thing with
 * collaborators, and pretending otherwise is how "just a stub" quietly becomes
 * four hundred lines of setup.
 *
 * `buildWorld` supplies the boring ones: a working store, the default seat
 * table, a mailer that succeeds silently, an audit log that does nothing. A
 * probe overrides only its own seam. That keeps the comparison in
 * `detection.test.ts` honest — when the dummy probe catches a fault the spy
 * probe misses, the difference is the double, not the setup around it.
 */

import { InMemoryUserStore } from './fake'
import { StubSeatPolicy } from './stub'
import type {
  AuditLog,
  Mailer,
  RegisterUserDeps,
  RegisterUserResult,
  RegisteredUser,
  WelcomeDetails,
} from './registerUser'

/** A mailer that accepts everything and remembers nothing. */
export class InertMailer implements Mailer {
  async sendWelcome(_email: string, _details: WelcomeDetails): Promise<void> {}
  async sendUpgradeNudge(_email: string): Promise<void> {}
}

/** The passive dummy — see the argument against it in `dummy.ts`. */
export class InertAuditLog implements AuditLog {
  async write(): Promise<void> {}
}

export function buildWorld(overrides: Partial<RegisterUserDeps> = {}): RegisterUserDeps {
  return {
    users: new InMemoryUserStore(),
    seats: new StubSeatPolicy(),
    mailer: new InertMailer(),
    audit: new InertAuditLog(),
    ...overrides,
  }
}

/**
 * Narrows a result to the registered user, failing loudly if it was rejected.
 *
 * A probe that carried on against `result.user` after a rejection would report
 * a type error or `undefined`, and the reason the registration failed — the
 * thing you actually need — would be nowhere in the message.
 */
export function expectRegistered(result: RegisterUserResult): RegisteredUser {
  if (result.status !== 'registered') {
    throw new Error(`expected a registered user, got rejection: ${result.reason}`)
  }

  return result.user
}
