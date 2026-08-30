/**
 * Every snapshot this repository has agreed to keep, with a budget and a
 * reason.
 *
 * ---------------------------------------------------------------------------
 * What deserves a snapshot
 * ---------------------------------------------------------------------------
 * The measurement in `detection.test.ts` gives three conditions, and a
 * snapshot is worth its cost when all three hold:
 *
 *   1. **The output is wide.** Enough facts that an assertion suite covering
 *      the same ground would be dozens of `expect` calls — and would still
 *      miss the two the corpus reaches and nobody thought to name.
 *   2. **The output is stable.** It changes when behaviour changes and not
 *      otherwise. This is the condition raw markup fails: six refactors here
 *      changed nothing a reader can perceive and turned the full snapshot red
 *      every time, for a 62.5% signal rate.
 *   3. **Somebody will actually read the diff.** Which is a claim about size
 *      and about where the diff appears, not about the technique.
 *
 * Where 2 fails, project first and snapshot the projection. Where 3 fails,
 * the snapshot is a rubber stamp with a filename, whatever it catches.
 *
 * ---------------------------------------------------------------------------
 * Why a registry rather than a lint rule
 * ---------------------------------------------------------------------------
 * The failure this exists to stop is a snapshot *appearing*, or growing, with
 * nobody deciding that it should. A lint rule banning `toMatchSnapshot`
 * outright is the usual response and it is too blunt: the full-markup snapshot
 * in `full.test.ts` is the only probe here that catches all ten bugs, and a
 * policy that forbids it is a policy that trades a real defence for a tidier
 * rule.
 *
 * So snapshots are allowed, and each one must be *declared* — with a line
 * budget and one sentence saying why it is a snapshot rather than assertions.
 * The table is closed in both directions, the same rule `mutation/scope.ts`
 * and `shape/boundaries.ts` apply: a snapshot on disk with no row fails, and a
 * row matching nothing on disk fails. Both are silent otherwise, and both mean
 * the policy has stopped describing the repository.
 *
 * Writing the row is the whole point. It is thirty seconds, it happens at the
 * moment somebody is deciding, and it is the only moment at which anybody will
 * ever weigh that decision — `-u` at 6pm on a Friday is not one.
 */

/** One snapshot the repository has agreed to keep. */
export interface Registration {
  /** Repo-relative path of the test file that owns it. */
  readonly file: string
  /**
   * The snapshot's name: the full `describe > it` key including Vitest's
   * trailing counter for a file snapshot, the enclosing test's title for an
   * inline one.
   */
  readonly name: string
  readonly kind: 'file' | 'inline'
  /**
   * The most lines this snapshot may contain.
   *
   * Not a round number and not today's exact size. Round numbers are
   * arbitrary and a snug budget goes red on the next honest commit, which
   * trains exactly the reflex this whole directory is about — so each budget
   * below leaves stated headroom, and `policy.ts#headroom` reports it so the
   * slack is visible rather than assumed.
   */
  readonly budget: number
  /** Why this is a snapshot rather than a handful of assertions. */
  readonly why: string
}

export const REGISTRY: readonly Registration[] = [
  {
    file: 'snapshot/full.test.ts',
    name: 'the order summary markup > renders a paid order in full 1',
    kind: 'file',
    budget: 48,
    why:
      'The demonstration of the widest form, and the only probe here that catches all ten ' +
      'injected bugs. One order rather than four: the corpus is covered by the projection, ' +
      'because four documents is 138 lines of snapshot and nobody reads the fourth.',
  },
  {
    file: 'snapshot/projected.test.ts',
    name: 'lists every value of a paid order, in document order',
    kind: 'inline',
    budget: 22,
    why: 'The recommended form: published fields only, in the reviewer’s eye-line.',
  },
  {
    file: 'snapshot/projected.test.ts',
    name: 'shows the discount line, negative, when there is a discount',
    kind: 'inline',
    budget: 26,
    why: 'The discount branch and the escaping of a customer name, as published values.',
  },
  {
    file: 'snapshot/projected.test.ts',
    name: 'says one item in the singular, and charges no tax in USD',
    kind: 'inline',
    budget: 20,
    why: 'The singular caption and the zero-rate currency, which no other case reaches.',
  },
  {
    file: 'snapshot/projected.test.ts',
    name: 'still totals delivery and tax when the order has no items',
    kind: 'inline',
    budget: 18,
    why:
      'The empty branch. Its value is the line that is *not* there — no itemCount is ' +
      'published at all — which is the one thing a projection states better than markup.',
  },
]

export function registrationFor(file: string, name: string): Registration | null {
  return REGISTRY.find((entry) => entry.file === file && entry.name === name) ?? null
}
