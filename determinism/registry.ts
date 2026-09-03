/**
 * Every ambient read of a clock, a random source, an identity source or a
 * scheduler in this repository, with the reason it is allowed to stay.
 *
 * ---------------------------------------------------------------------------
 * Why a registry rather than a ban
 * ---------------------------------------------------------------------------
 * A lint rule forbidding `Date.now()` in a test is easy to write and gets
 * turned off within a month, because some of these reads are correct. The
 * ambient clock behind an injection point is *supposed* to call the real one.
 * A load script's think time is *supposed* to be random. A visual test that
 * renders a timestamp and then masks it is demonstrating masking, and
 * replacing the timestamp with a constant would delete the thing being
 * demonstrated.
 *
 * What is not fine is a read nobody decided on. So the rule is not "never" but
 * "not without a row": each entry below names a file, a source kind, how many
 * such reads that file has, what they are for, and a sentence of reason. The
 * count is what makes it bite — an eleventh read in a file that has ten is a
 * failure, and that is the case a per-file allowlist would wave through.
 *
 * Closed in both directions, like `mutation/scope.ts` and
 * `snapshot/registry.ts`: a site with no row fails, and a row with no site
 * fails. The second half matters more than it looks. Without it the table
 * silts up with entries for code that was deleted years ago, and the day
 * somebody re-adds a read to that file it is already blessed.
 *
 * ---------------------------------------------------------------------------
 * On the dispositions
 * ---------------------------------------------------------------------------
 * Five, and they are meant to be exhaustive for a healthy repository. If a
 * site does not fit one of them, that is a signal about the site rather than
 * about the vocabulary — the honest move is to fix the code, not to invent a
 * sixth word for it.
 */

import type { SourceKind } from './audit.ts'

export const DISPOSITIONS = ['measured', 'seam-default', 'inert', 'masked', 'shaping'] as const

export type Disposition = (typeof DISPOSITIONS)[number]

export const DISPOSITION_NOTES: Readonly<Record<Disposition, string>> = {
  measured:
    'The uncontrolled read is the subject. Removing it would delete the ' +
    'measurement — this is the only disposition that argues for ambient ' +
    'nondeterminism rather than tolerating it.',
  'seam-default':
    'The real implementation sitting behind an injection point, so that ' +
    'production gets a clock and tests get whatever they pass in. Correct by ' +
    'construction; the thing to check is that a test never reaches it.',
  inert:
    'The value is produced and never asserted on. Harmless today, and the ' +
    'reason to register rather than ignore it is that "never asserted on" is a ' +
    'property of the current assertions, not of the value.',
  masked:
    'The value reaches an artefact that deliberately hides it. Replacing it ' +
    'with a constant would make the demonstration vacuous.',
  shaping:
    'The draw shapes a workload rather than deciding an assertion. A load ' +
    'profile with no variance is not a load profile.',
}

export interface RegistryEntry {
  /** Repository-relative path, exactly as `audit.ts` reports it. */
  readonly file: string
  readonly kind: SourceKind
  /** How many reads of this kind the file has. */
  readonly count: number
  readonly disposition: Disposition
  readonly why: string
}

export const REGISTRY: readonly RegistryEntry[] = [
  // -------------------------------------------------------------------------
  // determinism/ — the reads this directory exists to measure
  // -------------------------------------------------------------------------
  {
    file: 'determinism/environment.ts',
    kind: 'wall-clock',
    count: 1,
    disposition: 'measured',
    why: '`ambientEnvironment.now` is the real `Date.now()`, on purpose: the four worlds built on it in `worlds.ts` are measuring what happens to code that has no control at all.',
  },
  {
    file: 'determinism/environment.ts',
    kind: 'monotonic-clock',
    count: 1,
    disposition: 'measured',
    why: '`ambientEnvironment.elapsed` is the real `performance.now()`. It is separate from the wall clock precisely so `ELAPSED_FROM_WALL_CLOCK` can be stated at all.',
  },
  {
    file: 'determinism/environment.ts',
    kind: 'randomness',
    count: 1,
    disposition: 'measured',
    why: 'The uncontrolled draw the `ambient` and `fake-timers` worlds run on.',
  },
  {
    file: 'determinism/environment.ts',
    kind: 'identity',
    count: 1,
    disposition: 'measured',
    why: '`crypto.randomUUID()` is the identity source `ID_DERIVED_FROM_CLOCK` replaces with a timestamp.',
  },
  {
    file: 'determinism/environment.ts',
    kind: 'scheduler',
    count: 1,
    disposition: 'measured',
    why: 'The real `setTimeout` behind `ambientEnvironment.schedule`. Read through the global at call time so that `vi.useFakeTimers()` can replace it, which is what `fidelity.test.ts` checks.',
  },
  {
    file: 'determinism/environment.test.ts',
    kind: 'scheduler',
    count: 1,
    disposition: 'measured',
    why: 'A real 20ms wait, to show that the canceller `ambientEnvironment.schedule` returns actually reaches the runtime timer. There is no way to demonstrate that against a fake queue — the queue would simply never run it either — so this is the one assertion in the directory that has to spend real milliseconds.',
  },
  {
    file: 'determinism/worlds.ts',
    kind: 'scheduler',
    count: 1,
    disposition: 'measured',
    why: 'The real sleep the three real-clock worlds wait on. `CLAUDE.md` says no sleeps; the cost of not controlling time cannot be measured by a probe that has already been fixed, and this is the one place the exception is taken.',
  },

  // -------------------------------------------------------------------------
  // Everything else
  // -------------------------------------------------------------------------
  {
    file: 'factories/factories.test.ts',
    kind: 'wall-clock',
    count: 4,
    disposition: 'inert',
    why: 'Two mock Prisma delegates stamp `createdAt`/`updatedAt` on rows they invent. Nothing in the file asserts on either field — the assertions are about the factory\'s overrides and sequences — so the value is produced and dropped.',
  },
  {
    file: 'k6/load-test.ts',
    kind: 'randomness',
    count: 1,
    disposition: 'shaping',
    why: 'Think time between iterations, drawn between SLEEP_MIN and SLEEP_MAX. A virtual user that pauses for exactly the same interval every time produces a synchronised thundering herd rather than a load profile, which is the same argument the subject in `session.ts` makes for jittering a refresh.',
  },
  {
    file: 'msw/db.ts',
    kind: 'wall-clock',
    count: 1,
    disposition: 'seam-default',
    why: 'The in-memory database stamps `createdAt` when a row is created, exactly as the real one would. It is a fixture standing in for a server, not a test.',
  },
  {
    file: 'msw/handlers/auth.ts',
    kind: 'wall-clock',
    count: 2,
    disposition: 'seam-default',
    why: 'Two handlers compute a session expiry fifteen minutes out. This is the mock *server*, and a server that issued a token with a constant expiry would be a worse imitation of one, not a more deterministic test.',
  },
  {
    file: 'playwright/visual.spec.ts',
    kind: 'randomness',
    count: 1,
    disposition: 'masked',
    why: 'A random order id rendered into the page under test. The point of the case is that `mask` hides it from the screenshot; a constant id would pass whether masking worked or not.',
  },
  {
    file: 'playwright/visual.spec.ts',
    kind: 'wall-clock',
    count: 3,
    disposition: 'masked',
    why: 'A tracking number and two renderings of the current time, all inside the masked regions of the same case. Same argument as the order id.',
  },
  {
    file: 'storybook/LoginForm.stories.tsx',
    kind: 'scheduler',
    count: 1,
    disposition: 'inert',
    why: 'The async-submit story resolves its spy after 200ms so the loading state is on screen long enough to be interacted with. The play function waits for the state rather than for the delay, so no assertion depends on the number.',
  },
  {
    file: 'tdd/characterisation/legacy/renewal.ts',
    kind: 'wall-clock',
    count: 1,
    disposition: 'seam-default',
    why: 'The default `now` behind the seam introduced by that directory\'s one pre-test edit. `seams.test.ts` substitutes it to prove the edit is a no-op when omitted.',
  },
  {
    file: 'tdd/characterisation/legacy/renewal.ts',
    kind: 'randomness',
    count: 1,
    disposition: 'seam-default',
    why: 'As above, for the audit-flag draw the legacy function used to make inline.',
  },
]

/** The key a site and a row agree on. */
export const rowKey = (file: string, kind: SourceKind): string => `${file}#${kind}`

export const entryFor = (file: string, kind: SourceKind): RegistryEntry | undefined =>
  REGISTRY.find((entry) => entry.file === file && entry.kind === kind)

/** What the audit refuses to vouch for. */
export type RegistryProblem =
  | { readonly kind: 'unregistered'; readonly file: string; readonly source: SourceKind; readonly lines: readonly number[] }
  | { readonly kind: 'stale-row'; readonly file: string; readonly source: SourceKind }
  | {
      readonly kind: 'count-changed'
      readonly file: string
      readonly source: SourceKind
      readonly registered: number
      readonly found: number
      readonly lines: readonly number[]
    }

export function describeProblem(problem: RegistryProblem): string {
  switch (problem.kind) {
    case 'unregistered':
      return `${problem.file} reads ${problem.source} at line(s) ${problem.lines.join(', ')} with no row in determinism/registry.ts`
    case 'stale-row':
      return `determinism/registry.ts has a row for ${problem.file} reading ${problem.source}, but no such read exists any more`
    case 'count-changed':
      return `${problem.file} now reads ${problem.source} ${problem.found} time(s) at line(s) ${problem.lines.join(', ')}, but its row says ${problem.registered}`
  }
}
