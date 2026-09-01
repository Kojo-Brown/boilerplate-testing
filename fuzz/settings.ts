/**
 * The constants every number in `README.md` is a property of.
 *
 * A fuzzing result is not a fact about a parser. It is a fact about a parser,
 * a generator, a seed and a budget, and quoting the first without the other
 * three is how a campaign report becomes folklore. `property/config.ts` pins
 * `fast-check`'s seed for the same reason and states it more strongly: a seed
 * only reproduces against the generator that produced it.
 *
 * Everything here is therefore a written-down constant rather than a default,
 * and `readme.test.ts` checks that the prose quotes these values rather than
 * remembered ones.
 */

/**
 * The seed every campaign starts from.
 *
 * One seed, not a fresh one per run. A fuzzer seeded from the clock finds a
 * different bug every night, which sounds like more coverage and is in fact a
 * CI job that fails on unrelated commits and passes on the retry — the exact
 * habit `snapshot/README.md` describes forming around a noisy signal. The
 * campaign here is a regression gate: deterministic, and if it is to explore
 * more, the budget goes up rather than the seed changing.
 */
export const SEED = 0x5eed_1234

/**
 * Inputs per campaign, before a probe gives up on a variant.
 *
 * Chosen from the measured curve in `README.md` rather than picked: the
 * detection matrix is unchanged from 2,000 down to 500 and loses two faults at
 * 250, so 2,000 is comfortably past the knee and still under two seconds for
 * the whole matrix.
 */
export const CAMPAIGN_BUDGET = 2_000

/**
 * How deep the structure-aware generator will nest, when it decides to.
 *
 * Well past the parser's limit of 64 and well past the engine's stack, which
 * is the point — a document this deep is the only input in the corpus that can
 * tell a parser with a depth guard from one without.
 */
export const DEEP_NESTING = 30_000

/** How often the structure-aware generator emits one of those. */
export const DEEP_NESTING_RATE = 0.02
