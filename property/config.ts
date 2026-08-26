/**
 * The seed, and why it is written down.
 *
 * A property test without a fixed seed is a different test on every run. That
 * is sometimes what you want — a nightly job that explores fresh inputs finds
 * things a pinned suite never will — but it is the wrong default for a gate
 * that blocks a merge, for two reasons that are easy to conflate:
 *
 *   1. **A failure has to be reproducible.** fast-check prints the seed and
 *      the shrink path on failure, so an unseeded run *can* be replayed — but
 *      only by someone who still has the log. Pinning the seed means the
 *      failing case is on the branch, not in a CI job that has since been
 *      garbage-collected.
 *   2. **A pass has to mean the same thing twice.** An unseeded property that
 *      catches a bug 3% of the time is a flaky test wearing a mathematician's
 *      hat: it will go green on the pull request that introduces the bug and
 *      red on an unrelated one a week later. `CLAUDE.md` asks for determinism
 *      by construction, and this is that rule applied to a random generator.
 *
 * The cost is real and worth stating: a pinned seed explores exactly one
 * sequence of inputs forever, so the suite stops finding new things the moment
 * it goes green. The honest arrangement is both — this seed in CI, and a
 * separate unpinned exploration run — and only the first half is built here.
 * `vitest/flaky.ts` already carries this repository's machinery for the
 * second, and wiring a nightly property sweep onto it is Phase 11 work
 * (flake detection), not this item's.
 *
 * ---------------------------------------------------------------------------
 * Why fast-check is pinned to an exact version
 * ---------------------------------------------------------------------------
 * A seed only reproduces a run against the generator that produced it. The
 * value stream fast-check derives from a seed is not part of its public API
 * and does change between minor releases, so `package.json` pins `fast-check`
 * exactly rather than with a caret. Without that, the measured figures in
 * `README.md` — overlap rates, shrink sizes, the detection matrix — would be
 * correct on the commit that recorded them and wrong after the next automated
 * dependency bump, with nothing to say which. `dependencies.test.ts` asserts
 * the pin, so removing it fails `pnpm test` rather than going quietly.
 */

/**
 * The seed every property in this directory runs under.
 *
 * The date this was written, as a number. Any constant would do; a memorable
 * one makes it obvious in a diff that somebody chose it rather than that it
 * arrived from a failing run and was never revisited.
 */
export const SEED = 20260826

/**
 * Runs per property.
 *
 * fast-check's default is 100, and a round number nobody measured is the usual
 * way this constant gets chosen — which is unfortunate, because it decides how
 * much of the suite is real. Measured against the strongest probe: 8 of the 10
 * faults caught at 25 runs, 9 at 50, still 9 at 100, and 10 at 200. So 200 is
 * where the corpus is fully covered and doubling again buys nothing measurable.
 * `detection.test.ts` records each of those figures at the edge, so the choice
 * fails rather than rots if an arbitrary changes underneath it.
 */
export const NUM_RUNS = 200

/**
 * The parameters every `fc.assert` and `fc.check` in this directory uses.
 *
 * Deliberately left unannotated. `fc.Parameters<T>` is generic in the value
 * type being generated, and annotating a shared constant as
 * `fc.Parameters<unknown>` pins that generic at every call site — which costs
 * nothing where the result is only inspected for `failed`, and loses the type
 * of `counterexample` where it is read. Inference from the property is what
 * keeps `shrinking.ts` able to say `counterexample[0].a`.
 */
export const RUN = {
  seed: SEED,
  numRuns: NUM_RUNS,
}

/** The same parameters with shrinking switched off, for `shrinking.test.ts`. */
export const RUN_WITHOUT_SHRINKING = {
  ...RUN,
  // `endOnFailure` stops fast-check the moment a counterexample is found, so
  // what comes back is the raw failing input rather than a reduced one. It is
  // the only honest way to measure what shrinking is worth: the alternative is
  // guessing at what the first failure looked like.
  endOnFailure: true,
}
