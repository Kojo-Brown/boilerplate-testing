/**
 * Turning a played timeline into one word, and the words into a score.
 *
 * ---------------------------------------------------------------------------
 * Why nine words and not "leaked / not leaked"
 * ---------------------------------------------------------------------------
 * The binary framing is what makes a TTL sweep look like a solution. Under it,
 * a sweep scores identically to a close hook on every teardown row — nothing
 * is left running at the end of either — and the reader concludes that the
 * cheap answer is as good as the careful one. It is not, and the difference is
 * a window: an environment removed four hours after its pull request closed
 * cost four hours of money and held its data for four hours, and a sentence
 * that calls both of those "cleaned up" has thrown away the only number anyone
 * would have wanted.
 *
 * The same argument in the other direction is why `orphaned` is separate from
 * `leaked`. Both are resources still running. One of them is written down in a
 * state file somebody can grep; the other is not referenced by anything at
 * all, and the way it is eventually found is an invoice.
 *
 * So, ordered by how bad they are and how long they stay invisible:
 *
 *   - `clean` — gone, at the moment it stopped being needed.
 *   - `live` — up, serving this pull request's head commit, with data only
 *     this pull request can see. The correct answer while a review is open.
 *   - `reaped` — it outlived its pull request and a sweep removed it later.
 *     Bounded cost, unbounded exposure window, and for two hazards it is the
 *     best any wiring achieves.
 *   - `broken` — there is no usable environment when there should be one.
 *     Nothing is corrupt and nothing is running up a bill; the review is just
 *     blocked, and somebody notices within minutes.
 *   - `stale` — up, and serving a commit that is not the head. A reviewer
 *     approves code that was never deployed. Discoverable, because the commit
 *     is written on the deployment.
 *   - `poisoned` — up, at the right commit, showing data another pull request
 *     wrote. Not discoverable: the screen looks exactly like a correct one.
 *   - `leaked` — still running after the pull request closed, and something
 *     still references it.
 *   - `orphaned` — still running, and nothing references it. Strictly worse
 *     than `leaked`: there is no list to reconcile against.
 *   - `exposed` — the repository's deployment secret ran against code a fork
 *     author controls. The only outcome here that is not about money.
 *
 * ---------------------------------------------------------------------------
 * The precedence, and the two judgement calls in it
 * ---------------------------------------------------------------------------
 * A run can satisfy several of these, so {@link classify} checks them in a
 * fixed order, and the order is a claim.
 *
 * **`exposed` outranks everything.** A leaked database costs money; a leaked
 * deployment credential costs whatever the credential can reach. It is checked
 * first even on rows where the environment is also wrong in some cheaper way,
 * because no amount of correct teardown is worth reporting about a wiring that
 * handed its secrets to an unreviewed contributor.
 *
 * **`poisoned` outranks `stale`.** Both are a reviewer approving something
 * they did not see, so the tie is broken on discoverability: a stale
 * environment states its commit and the mismatch is one glance away, while
 * poisoned data looks precisely like correct data. This is the same reasoning
 * `idempotency/scoring.ts` uses to put misattribution above a lost write, and
 * it is stated here rather than left to be inferred from the table.
 */

import type { Hazard } from './hazards.ts'
import type { Observation, ProbeResult } from './harness.ts'

export const OUTCOMES = [
  'clean',
  'live',
  'reaped',
  'broken',
  'stale',
  'poisoned',
  'leaked',
  'orphaned',
  'exposed',
] as const

export type Outcome = (typeof OUTCOMES)[number]

export function classify(observation: Observation, hazard: Hazard): Outcome {
  const subject = hazard.subject

  // 1. A deployment secret reached code a fork author wrote. Nothing below is
  //    worth knowing about a wiring that did this.
  if (observation.exposed.has(subject)) return 'exposed'

  if (hazard.expect === 'clean') {
    const alive = observation.cloud.query({ pr: String(subject) })

    if (alive.length === 0) {
      // Removed — the only remaining question is when. `sweep` means it
      // outlived its pull request by up to one sweep interval.
      return observation.removal.get(subject) === 'sweep' ? 'reaped' : 'clean'
    }

    // 2. Still running. Whether anything still knows about it is the
    //    difference between a reconciliation job and an invoice.
    const record = observation.deployer.record(subject)
    const referenced = record?.ids.some((id) => observation.cloud.has(id)) ?? false

    return referenced ? 'leaked' : 'orphaned'
  }

  const probe = lastProbe(observation, subject)

  if (probe === undefined) {
    throw new Error(`${hazard.key} expects a live environment but never probes pull request ${String(subject)}`)
  }

  // 3. Nothing to review. Either there is no service at all, or there is one
  //    and its data is at a schema its code cannot read — the same outcome for
  //    the reviewer, who gets an error page either way.
  if (probe.servingSha === null) return 'broken'
  if (probe.datasetSchema !== probe.expectedSchema) return 'broken'

  // 4. It works, and it is showing somebody else's writes.
  if (probe.foreignRows.length > 0) return 'poisoned'

  // 5. It works, the data is its own, and it is not this pull request's code.
  if (probe.servingSha !== probe.headSha) return 'stale'

  return 'live'
}

/** The last thing a reviewer saw, which is what they act on. */
export function lastProbe(observation: Observation, pr: number): ProbeResult | undefined {
  return observation.probes.filter((probe) => probe.pr === pr).at(-1)
}

/** Whether a cell is the answer its hazard calls correct. */
export const handled = (outcome: Outcome, hazard: Hazard): boolean => outcome === hazard.correct

/** How many hazards a strategy got right, out of how many there are. */
export function score(
  outcomes: ReadonlyMap<string, Outcome>,
  hazards: readonly Hazard[],
): { readonly handled: number; readonly of: number } {
  let count = 0

  for (const hazard of hazards) {
    const outcome = outcomes.get(hazard.key)

    if (outcome !== undefined && handled(outcome, hazard)) count += 1
  }

  return { handled: count, of: hazards.length }
}
