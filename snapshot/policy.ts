/**
 * The gate: what a snapshot has to satisfy to stay in the repository.
 *
 * Split from `check.ts` so the decision is a pure function of an inventory, a
 * registry and a list of test names. That is what lets `policy.test.ts` state
 * every interesting case — a snapshot nobody registered, a registration
 * nothing matches, a snapshot four lines over budget, one carrying a
 * timestamp, one left behind by a renamed test — without any of them having to
 * exist on disk.
 *
 * ---------------------------------------------------------------------------
 * The six rules, and the failure each one is for
 * ---------------------------------------------------------------------------
 *   `unregistered`   A snapshot appeared and nobody decided it should. This is
 *                    the common one: `toMatchSnapshot()` is one line, it
 *                    passes on the first run by construction, and it never
 *                    faces a reviewer who knows they are approving a new
 *                    assertion of unbounded scope.
 *
 *   `unused`         A registration matching nothing. Either the snapshot was
 *                    deleted and the row outlived it, or the test was renamed
 *                    and the row is now governing nothing at all. A registry
 *                    that has silently stopped applying is worse than none,
 *                    because it reads like coverage.
 *
 *   `over-budget`    The snapshot grew past what somebody agreed to read. This
 *                    is the rubber-stamping rule proper: nothing stops a
 *                    39-line snapshot becoming a 300-line one an update at a
 *                    time, and no single one of those updates looks wrong.
 *
 *   `volatile`       The snapshot contains something that changes on its own —
 *                    a timestamp, a uuid, an absolute path, a port. This is
 *                    the fastest way to train a team to run `-u` without
 *                    reading, because the snapshot is red for reasons that are
 *                    never anybody's fault, and the fix is always the same
 *                    keystroke. `orders.ts` writes every date down for this
 *                    reason.
 *
 *   `obsolete`       A `.snap` entry whose test no longer exists. Vitest
 *                    reports these and exits zero, so they accumulate; each
 *                    one is dead weight in a file the reviewer is already
 *                    disinclined to read.
 *
 *   `empty`          `toMatchInlineSnapshot()` with no argument, committed. It
 *                    passes, it asserts nothing, and it looks exactly like a
 *                    test. Also covers an interpolated template, whose
 *                    expected value is computed at run time and is therefore
 *                    not a snapshot of anything.
 */

import type { FoundInline, FoundSnapshot, Inventory } from './inventory.ts'
import { registrationFor, type Registration } from './registry.ts'

export type Violation =
  | { readonly kind: 'unregistered'; readonly file: string; readonly detail: string }
  | { readonly kind: 'unused'; readonly file: string; readonly detail: string }
  | { readonly kind: 'over-budget'; readonly file: string; readonly detail: string }
  | { readonly kind: 'volatile'; readonly file: string; readonly detail: string }
  | { readonly kind: 'obsolete'; readonly file: string; readonly detail: string }
  | { readonly kind: 'empty'; readonly file: string; readonly detail: string }

/**
 * Patterns that mean a snapshot will change without anybody changing the code.
 *
 * Deliberately conservative — every one of these matches something that cannot
 * be a stable expected value, and none of them matches ordinary prose or
 * money. A pattern that fired on real content would be a rule people route
 * around, which is how a gate stops being a gate.
 */
export const VOLATILE_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'an ISO timestamp', pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ },
  {
    name: 'a uuid',
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  },
  { name: 'an absolute path', pattern: /(?:^|[\s"'(])(?:\/(?:home|users|tmp|var)\/|[A-Z]:\\)/im },
  { name: 'a localhost port', pattern: /localhost:\d{2,5}/ },
  { name: 'an epoch timestamp in milliseconds', pattern: /\b1[6-9]\d{11}\b/ },
  { name: 'a Mongo-style object id', pattern: /\bObjectId\("?[0-9a-f]{24}"?\)/i },
]

/** The volatile things a snapshot's content contains, by name. */
export function volatilityOf(content: string): string[] {
  return VOLATILE_PATTERNS.filter((rule) => rule.pattern.test(content)).map((rule) => rule.name)
}

/** Lines a snapshot may still grow by before its budget binds. */
export function headroom(snapshot: FoundSnapshot, registration: Registration): number {
  return Math.max(0, registration.budget - snapshot.lines)
}

/** A snapshot paired with the registration that governs it. */
export interface GovernedSnapshot {
  readonly snapshot: FoundSnapshot
  readonly registration: Registration
  readonly headroom: number
}

export interface Evaluation {
  readonly governed: readonly GovernedSnapshot[]
  readonly violations: readonly Violation[]
}

const isInline = (snapshot: FoundSnapshot): snapshot is FoundInline => snapshot.kind === 'inline'

/**
 * Judge an inventory.
 *
 * `registry` and `testNames` are parameters rather than module constants for
 * the reason `mutation/policy.ts` gives: a gate whose own tests can only ever
 * assert against the production tables is a gate that has to be broken in
 * production to be tested at all.
 *
 * `testNames` is the set of `describe > it` names the runner reports, used
 * only for the obsolete rule. Passing `null` skips that rule, which is what
 * `policy.test.ts` does for every case that is not about it — obsolescence is
 * the one rule that cannot be decided from the filesystem alone.
 */
export function evaluate(
  inventory: Inventory,
  registry: readonly Registration[],
  testNames: ReadonlySet<string> | null,
): Evaluation {
  const violations: Violation[] = []
  const governed: GovernedSnapshot[] = []
  const seen = new Set<string>()

  // NUL as the separator: it is the one character that cannot appear in a
  // file path or a test title, so no pair of (file, name) can collide with
  // another by concatenation.
  const key = (file: string, name: string): string => `${file}\u0000${name}`

  for (const snapshot of inventory.snapshots) {
    const registration =
      registry.find((entry) => entry.file === snapshot.file && entry.name === snapshot.name) ?? null

    if (registration === null) {
      violations.push({
        kind: 'unregistered',
        file: snapshot.file,
        detail:
          `${snapshot.lines}-line ${snapshot.kind} snapshot "${snapshot.name}" is not in ` +
          'registry.ts. Add a row with a budget and a sentence saying why it is a snapshot, ' +
          'or replace it with assertions.',
      })
    } else {
      seen.add(key(registration.file, registration.name))
      governed.push({ snapshot, registration, headroom: headroom(snapshot, registration) })

      if (registration.kind !== snapshot.kind) {
        violations.push({
          kind: 'unregistered',
          file: snapshot.file,
          detail:
            `"${snapshot.name}" is registered as a ${registration.kind} snapshot but was ` +
            `found as an ${snapshot.kind} one. The budgets differ by form, so this is a ` +
            'decision to re-make rather than a row to edit.',
        })
      }

      if (snapshot.lines > registration.budget) {
        violations.push({
          kind: 'over-budget',
          file: snapshot.file,
          detail:
            `"${snapshot.name}" is ${snapshot.lines} lines against a budget of ` +
            `${registration.budget}. Either narrow what is snapshotted, or raise the budget ` +
            'deliberately and say in the row why the larger one will still be read.',
        })
      }
    }

    const volatile = volatilityOf(snapshot.content)

    if (volatile.length > 0) {
      violations.push({
        kind: 'volatile',
        file: snapshot.file,
        detail:
          `"${snapshot.name}" contains ${volatile.join(' and ')}. A snapshot that changes on ` +
          'its own is red for reasons nobody caused, and the fix is always `-u` — which is ' +
          'the habit. Inject the clock, seed the generator, or redact the field.',
      })
    }

    if (isInline(snapshot) && !snapshot.literal) {
      violations.push({
        kind: 'empty',
        file: snapshot.file,
        detail:
          `"${snapshot.name}" calls ${snapshot.matcher} with no literal snapshot. It passes ` +
          'and asserts nothing until somebody runs with `-u`.',
      })
    }
  }

  for (const entry of registry) {
    if (!seen.has(key(entry.file, entry.name))) {
      violations.push({
        kind: 'unused',
        file: entry.file,
        detail:
          `registry.ts declares "${entry.name}" in ${entry.file}, and no such snapshot exists. ` +
          'The snapshot was deleted or its test was renamed, and this row now governs nothing.',
      })
    }
  }

  if (testNames !== null) {
    for (const snapshot of inventory.snapshots) {
      if (snapshot.kind !== 'file') {
        continue
      }

      // Vitest appends ` 1`, ` 2`, … to distinguish several snapshots in one
      // test. The test's own name is everything before that counter.
      const testName = snapshot.name.replace(/ \d+$/, '')

      if (!testNames.has(testName)) {
        violations.push({
          kind: 'obsolete',
          file: snapshot.file,
          detail:
            `"${snapshot.name}" belongs to a test that no longer exists. Vitest reports these ` +
            'and exits zero, so they accumulate until the file is too tedious to read.',
        })
      }
    }
  }

  return { governed, violations }
}

export { registrationFor }
