/**
 * What is under mutation, which suites are held responsible for it, and how
 * low each one may score before CI says otherwise.
 *
 * ---------------------------------------------------------------------------
 * Why the scope is declared rather than globbed
 * ---------------------------------------------------------------------------
 * Mutation testing is the most expensive measurement in this repository by an
 * order of magnitude. `pnpm test` runs the whole suite once; a mutation run
 * re-runs the covering tests once per mutant, and this directory's four
 * modules alone produce several hundred. Pointed at every source file here it
 * would be a job nobody waits for, and a gate nobody waits for is a gate that
 * gets `continue-on-error: true` within a month.
 *
 * So the scope is a table. Each entry names one module, the floor its score
 * may not fall below, and the reason that module is worth the minutes. The
 * table is the honest version of the thing every mutation-testing setup does
 * silently through a glob: decide what it is willing to pay for.
 *
 * ---------------------------------------------------------------------------
 * Why suites are derived and not declared
 * ---------------------------------------------------------------------------
 * The one number a scoped mutation run can quietly get wrong is the score
 * itself, and it gets it wrong in the flattering direction *and* the harsh one
 * depending on which suites are loaded.
 *
 * Run a module's mutants against too few suites and every mutant only the
 * missing suite would have caught is recorded as survived — the report says
 * the tests are weak when the truth is that they were not invited. Run them
 * against the whole repository instead and the dry run pays for 1,100 tests to
 * discover what a handful of files cover.
 *
 * Neither is a decision worth making by hand once per module, so it is not
 * made by hand: `reach.ts` walks the import graph — the same walk
 * `shape/classify.ts` performs for the ratio policy — and answers *every test
 * file in this repository that can reach this module*. That set is what
 * `vitest.config.ts` includes and what `scope.test.ts` asserts is complete.
 * A new suite covering a scoped module is picked up by the next run without
 * anybody remembering to add it, and a scope entry cannot understate its own
 * score by omission.
 *
 * ---------------------------------------------------------------------------
 * Where the floors come from
 * ---------------------------------------------------------------------------
 * Every floor below is a whole number chosen to sit a stated number of
 * *mutants* under the measured score, not a stated number of percentage
 * points — `README.md` prints both, and `policy.ts#headroom` computes the
 * first from the second so the table and the prose cannot disagree.
 *
 * Mutants rather than points because points are not comparable across
 * modules: `factories/defineFactory.ts` has fourteen valid mutants, so one
 * lost mutant is 7.1 points, while the same loss on `property/availability.ts`
 * is 0.65. A uniform "five points of slack" would be six mutants of slack on
 * one module and none at all on another.
 *
 * The floors are deliberately not snug, because a floor drawn at today's exact
 * number goes red on the next honest commit and trains everybody to raise the
 * floor rather than read the report.
 *
 * What they actually catch is measured in `README.md` rather than assumed, and
 * the answer is narrower than the folklore. Deleting a single assertion from a
 * suite here does not move the score at all; neither does deleting a whole
 * behaviour from *both* suites that test it, because the suites in this
 * repository are redundant enough to cover for each other. What does move it,
 * hard, is code arriving with no test pointed at it: eight untested lines took
 * `factories/defineFactory.ts` from 100% to 58.33% in one commit. That is the
 * failure these floors are set to catch, and the `sole` column in the gate's
 * output is what says which modules are exposed to the other one.
 *
 * Raising a floor after an improvement is welcome. Lowering one is a code
 * review conversation, and CLAUDE.md is explicit that it may not be done to
 * make a red build green.
 */

/** One module under mutation, with the floor its score may not fall below. */
export interface ScopeEntry {
  /** Repo-relative path of the module Stryker mutates. */
  readonly module: string
  /**
   * The lowest mutation score, in percent, this module may report.
   *
   * Compared against the score *including* mutants with no coverage, which is
   * the pessimistic of the two figures Stryker prints. The other one —
   * "covered" — silently forgives an entire unreached branch, so gating on it
   * would let deleting the only test for a function raise the score.
   */
  readonly floor: number
  /** Why this module is worth the minutes, and what its mutants are about. */
  readonly why: string
}

/**
 * The closed table of modules under mutation.
 *
 * Closed in both directions, and `scope.test.ts` enforces both: a module here
 * that does not exist on disk fails, and — the half that matters — a file
 * Stryker reports a score for that is not listed here fails too. The second
 * rule is what stops the `mutate` glob and this table drifting apart, and it
 * is only possible because `stryker.config.mjs` derives the glob from this
 * array rather than repeating it.
 */
export const SCOPE: readonly ScopeEntry[] = [
  {
    module: 'property/availability.ts',
    floor: 78,
    why:
      'Interval arithmetic over half-open ranges: the densest arithmetic and ' +
      'comparison logic in the repository, and the subject of `property/`. Its ' +
      'suites are the interesting case for mutation testing because two of them ' +
      'test the same code in completely different ways — twenty fast-check ' +
      'invariants and twenty-four hand-written examples — so one run scores both ' +
      'against an identical corpus of faults. See README.md.',
  },
  {
    module: 'tdd/conventions/refundPolicy.ts',
    floor: 90,
    why:
      'Eight behaviours tested twice over, once Arrange-Act-Assert and once ' +
      'Given-When-Then. The conventions differ in every line of their bodies and ' +
      'in nothing a mutant can see, which is the claim `tdd/conventions/README.md` ' +
      'makes and the one this run can actually check.',
  },
  {
    module: 'factories/defineFactory.ts',
    floor: 85,
    why:
      'The test-data factory every other pattern here builds fixtures with. A ' +
      'weak suite around a factory is uniquely expensive: it does not fail, it ' +
      'quietly hands wrong data to everything downstream.',
  },
  {
    module: 'tdd/doubles/registerUser.ts',
    floor: 80,
    why:
      'The system the five kinds of test double are demonstrated against. ' +
      '`tdd/doubles/` already measures detection against five hand-written ' +
      'faults; Stryker generates the mechanical corpus the same suites face, ' +
      'which is the comparison `README.md` reports.',
  },
]

/**
 * The floor for the run as a whole.
 *
 * Not the mean of the per-module floors and not their minimum: the run's score
 * is a weighted average over the pooled mutants, so a module with ten times
 * the mutants of another moves it ten times as far, and a floor derived from
 * the per-module ones would go red on a change to the *scope* rather than on a
 * weakened test.
 *
 * It exists to catch the one case the per-module floors cannot — a change that
 * costs several modules a couple of mutants each, staying inside every
 * individual floor while the suite as a whole gets worse. Its own slack is set
 * the same way as theirs, in mutants, and stated in `README.md`.
 */
export const OVERALL_FLOOR = 83

/** Look up one entry, or `undefined` when the module is not in scope. */
export const entryFor = (module: string): ScopeEntry | undefined =>
  SCOPE.find((entry) => entry.module === module)

/** Every module under mutation, in table order. */
export const scopedModules = (): readonly string[] => SCOPE.map((entry) => entry.module)
