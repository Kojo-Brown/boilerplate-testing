/**
 * **Dummy** — present to satisfy a signature, never actually used.
 *
 * A dummy carries no behaviour and no expectations. It is what you pass when
 * the code under test needs a collaborator to exist on a path where it is
 * never touched: here, the audit log, which registration writes to only when
 * an admin registered somebody else.
 *
 * There are two ways to write one, and the choice is not cosmetic:
 *
 *  - **Passive** (`InertAuditLog` in `world.ts`): methods that do nothing. Easy
 *    to reach for, and it makes "the dummy is never used" an untested claim —
 *    the day the use case starts writing an audit entry for every signup, this
 *    test says nothing.
 *  - **Landmine** (below): methods that throw. The claim becomes executable.
 *    The test now fails the moment the collaborator is used on a path where it
 *    was supposed to be irrelevant.
 *
 * Prefer the landmine. It costs one line and it is the only version of a dummy
 * that can ever fail, which is the whole reason `AUDITS_EVERY_REGISTRATION` in
 * `faults.ts` is caught here and nowhere else.
 *
 * The limit worth knowing: a landmine reports "you used me", not "you used me
 * wrongly". If the collaborator genuinely belongs on the path, stop reaching
 * for a dummy — a spy or a mock is the tool.
 */

import type { AuditEntry, AuditLog } from './registerUser'

export class LandmineAuditLog implements AuditLog {
  async write(entry: AuditEntry): Promise<void> {
    throw new Error(
      `LandmineAuditLog: the audit log was written to on a path that must not audit — ` +
        `${entry.actorId} / ${entry.action} / ${entry.subject}`,
    )
  }
}

/**
 * The audit log used as a spy, for the one path that is supposed to audit.
 *
 * It lives in the dummy's file deliberately: the same collaborator, the same
 * interface, a different kind of double, because a different test wants a
 * different thing from it. The kind is chosen by the test.
 */
export class SpyAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = []

  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry)
  }
}
