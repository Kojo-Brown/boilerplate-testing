/**
 * The three durations every cell in this directory is measured against.
 *
 * They are in a module of their own, with no imports, because both halves of
 * the measurement need them and neither may reach the other: `origin.ts` opens
 * a socket, and a test that imported it would be an integration test under
 * `shape/boundaries.ts` even if all it wanted was a number.
 *
 * ---------------------------------------------------------------------------
 * Why these values
 * ---------------------------------------------------------------------------
 * The gaps between them are the whole design, because the one thing this
 * directory must not publish is a table of timings. No cell is a duration —
 * what the runs record is which of three *bands* a call landed in — so the
 * only property these numbers need is that no band boundary is reachable by a
 * runner having a bad day:
 *
 *   - The slowest `prompt` cell is a wiring that re-attempts three times and
 *     abandons each attempt at `BUDGET_MS`: 300ms against a 600ms boundary.
 *   - The slowest `waited-out` cell is a wiring that sat through one injected
 *     fault: 900ms against a 1,500ms boundary.
 *
 * So every boundary has at least 300ms of clearance on both sides, and a
 * finer-grained set of numbers would buy nothing: there is no published claim
 * that a tighter margin would make more precise, and there is a real cost to
 * getting it wrong, which is a red build that means nothing. `WAITED_OUT_FLOOR_MS`
 * is where that cost was actually paid — see the note on it below.
 *
 * The total is a few seconds. `runs.ts` fans the faults out rather than walking
 * them, which is sound here because almost all of this time is a timer rather
 * than a CPU.
 */

/** What a client's timeout is set to: the deadline the *policy* enforces. */
export const BUDGET_MS = 100

/**
 * How long the injected latency faults last.
 *
 * Past `BUDGET_MS` by 9x, so that a policy with a working timeout cannot
 * possibly finish — and so that a policy which *did* finish is known to have
 * waited the fault out rather than got lucky.
 */
export const INJECTED_MS = 900

/**
 * The harness's own patience, after which a call is recorded as `hung`.
 *
 * This is not a timeout the policy gets any credit for — it belongs to
 * `runs.ts` and exists so that a wiring with no working timeout produces a
 * cell instead of a stuck suite. A policy that only ever returns because of
 * this number has failed, and `hung` is how the table says so.
 */
export const DEADLINE_MS = 1_500

/**
 * The boundary between the `prompt` and `waited-out` bands.
 *
 * Derived rather than chosen, and it is the one number here that was got wrong
 * first. The obvious boundary is `INJECTED_MS` itself — "did the call last as
 * long as the fault?" — and it is unusable: the slowest legitimate `prompt`
 * cell settles at 300ms and the fastest `waited-out` cell settles at
 * `INJECTED_MS` **plus half a millisecond**, because a call that waits for a
 * 900ms timer takes 900.5ms. A boundary with 0.5ms of clearance is a coin
 * toss, and the first draft of this directory published a band that flipped
 * between two runs on exactly that cell.
 *
 * So the boundary is the midpoint of the two populations instead:
 *
 *   - The slowest `prompt` cell is a wiring that re-attempts `MAX_ATTEMPTS`
 *     times and abandons each attempt at `BUDGET_MS`: 3 x 100 = 300ms.
 *   - The fastest `waited-out` cell is a wiring that sat through one injected
 *     fault: 900ms.
 *
 * Midway is 600ms, which leaves 300ms of clearance on both sides — three times
 * the whole budget, and far more than a loaded runner moves.
 */
export const WAITED_OUT_FLOOR_MS = 600
