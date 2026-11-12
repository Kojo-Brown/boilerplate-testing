/**
 * The fixture's only source of duration.
 *
 * A test-time budget measures wall clock, so the subject of the measurement
 * has to spend some. It spends it on arithmetic rather than on a timer:
 * `setTimeout` would hand the scheduler a number and wait to be woken, which
 * is a measurement of the event loop's punctuality and is almost perfectly
 * repeatable. Real suites are slow because they *compute*, and compute is what
 * contends for a core with the other workers, the garbage collector and
 * whatever else the runner is doing — which is the noise this directory exists
 * to quantify.
 *
 * `spin` is therefore deliberately not `await sleep(ms)`. It is also not a
 * fixed iteration count: a count that takes 40ms on one machine takes 400 on
 * another, and the corpus would stop being comparable the moment it was
 * recorded somewhere else. It burns until the clock says it is done, so the
 * recorded durations are in milliseconds everywhere and the *spread* around
 * them is the machine's.
 */

/** Burn CPU until `ms` of wall clock has passed. Returns the work done. */
export function spin(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`not a duration: ${String(ms)}`)
  }

  const until = performance.now() + ms
  let acc = 0

  // A cheap, unpredictable-to-the-optimiser reduction. The accumulator is
  // returned so that neither the engine nor a reader can treat the loop as
  // dead code.
  for (let i = 1; performance.now() < until; i += 1) {
    acc += Math.sqrt(i) % 1
  }

  return acc
}
