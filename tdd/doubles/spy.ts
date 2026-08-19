/**
 * **Spy** — records what happened; the test decides afterwards what mattered.
 *
 * A spy answers calls the way a stub does (here: by doing nothing and
 * succeeding) and additionally keeps a log. Every assertion happens *after*
 * the act, in the test, against that log.
 *
 * The consequence is worth being precise about, because it is the whole
 * difference from a mock: a spy is silent about interactions the test did not
 * ask about. If the system starts making an extra call, a spy-based test keeps
 * passing unless somebody thought to assert on the absence of that call. That
 * leniency is usually what you want — it is what stops interaction tests from
 * failing every time an unrelated collaborator is added — and it is exactly
 * what `faults.ts` exploits with `NUDGES_AT_REGISTRATION`.
 *
 * Written by hand rather than with `vi.fn()` so the recorded shape is typed
 * and the assertions read as domain facts (`mailer.welcomes`) instead of
 * positional argument indexing. `vi.fn()` is the right reach in a real suite;
 * see `README.md`.
 */

import type { Mailer, Plan, WelcomeDetails } from './registerUser'

export type WelcomeCall = {
  readonly email: string
  readonly plan: Plan
}

export class SpyMailer implements Mailer {
  readonly welcomes: WelcomeCall[] = []
  readonly nudges: string[] = []

  async sendWelcome(email: string, details: WelcomeDetails): Promise<void> {
    this.welcomes.push({ email, plan: details.plan })
  }

  async sendUpgradeNudge(email: string): Promise<void> {
    this.nudges.push(email)
  }
}
