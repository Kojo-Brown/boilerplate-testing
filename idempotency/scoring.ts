/**
 * Turning a run into one word, and the word into a score.
 *
 * ---------------------------------------------------------------------------
 * Why seven words and not two
 * ---------------------------------------------------------------------------
 * The usual framing of idempotency is binary — the duplicate was prevented or
 * it was not — and the binary framing is what makes `memo-before` look like a
 * fix. It *is* a fix, for duplicates. What it does with the traffic it stops
 * duplicating is lose it, and a vocabulary with one failure word in it scores
 * "charged the customer twice" and "took the order and never charged anybody"
 * as the same cell.
 *
 * They are not the same cell. A duplicate charge is discovered by the customer
 * within a day and refunded. A lost write is discovered by nobody, because the
 * client was told 200 and the row is simply not there. So the outcomes are
 * ordered by how bad they are and how long they stay invisible:
 *
 *   - `safe` — the world matches what a correct implementation would leave and
 *     the client was told the truth about it.
 *   - `rejected` — the retry was deliberately refused, and refusing was right.
 *     A distinct word from `safe` because for two hazards it *is* the correct
 *     answer, and scoring a correct 422 as "not safe" would reward replaying.
 *   - `blocked` — the retry was refused with 409 and the operation is not done.
 *     Nothing is corrupt; the client simply has no answer and the work is
 *     stranded. Never the correct outcome for any hazard here.
 *   - `duplicate` — the effect happened more times than it should have.
 *   - `lost` — the effect happened fewer times than it should have, and the
 *     client was told it succeeded. The failure that is never discovered.
 *   - `orphaned` — money moved and no record of it exists. Worse than either,
 *     and reachable by exactly one pairing in the matrix.
 *   - `wrong-response` — the effects are right and the answer is not: the
 *     client was handed a description of an operation it did not perform, or
 *     somebody else's.
 *
 * ---------------------------------------------------------------------------
 * The precedence, and the one judgement call in it
 * ---------------------------------------------------------------------------
 * A run can satisfy several of these at once, so `classify` checks them in a
 * fixed order and the order is a claim about severity. The one worth arguing
 * about is that **misattribution outranks a lost write**. In
 * `cross-principal-key` against `memo-after` both are true — the second
 * customer's charge never happens *and* they are shown the first customer's
 * charge id — and the cell reads `wrong-response`. The reasoning is that a lost
 * write is an availability failure inside one tenant and a leaked charge id is
 * a confidentiality failure across two, and the README says so out loud rather
 * than leaving the reader to infer a severity model from a table.
 */

import type { Hazard } from './hazards.ts'
import type { Observation } from './harness.ts'

export const OUTCOMES = [
  'safe',
  'rejected',
  'blocked',
  'duplicate',
  'lost',
  'orphaned',
  'wrong-response',
] as const

export type Outcome = (typeof OUTCOMES)[number]

const isSuccess = (status: number): boolean => status >= 200 && status < 300

/**
 * Did any delivery get told about a charge belonging to somebody else?
 *
 * Reads the `chargeId` out of each answered response and compares the charge
 * row's principal with the principal that asked. This is the only check here
 * that looks inside a response body, and it is the only bug in the corpus that
 * a count of rows cannot see.
 */
function answeredWrongly(observation: Observation, hazard: Hazard): boolean {
  const charges = observation.store.committed('charges')

  return observation.deliveries.some((delivery) => {
    const response = delivery.response

    if (response === null || !isSuccess(response.status)) return false

    const spec = hazard.deliveries.find((candidate) => candidate.label === delivery.label)

    if (spec === undefined) return false

    // Was this caller told about a charge belonging to somebody else? The
    // cross-tenant leak, and the only bug in the corpus a row count cannot see.
    const chargeId = response.body['chargeId']

    if (typeof chargeId === 'string') {
      const row = charges.find((candidate) => candidate['id'] === chargeId)

      if (row !== undefined && row['principal'] !== spec.request.principal) return true
    }

    // Was this caller told about a *different request* of their own? A replay
    // keyed on nothing but the key answers a retry that changed the amount with
    // the original amount, and answers it 200. The effect count is right, one
    // charge exists, and the client has been told its 99.00 charge succeeded
    // when what exists is a 25.00 one. Without this check that reads as `safe`,
    // which is how the second most common idempotency bug stays invisible.
    const answered = response.body['amount']

    return typeof answered === 'number' && answered !== spec.request.amount
  })
}

/** The last answer any delivery received, which is what the client ends up knowing. */
function finalAnswer(observation: Observation): { status: number; replayed: boolean } | null {
  for (let index = observation.deliveries.length - 1; index >= 0; index -= 1) {
    const response = observation.deliveries[index]?.response

    if (response !== undefined && response !== null) {
      return { status: response.status, replayed: response.replayed }
    }
  }

  return null
}

export function classify(observation: Observation, hazard: Hazard): Outcome {
  const charges = observation.charges
  const effects = observation.gatewayEffects
  const answer = finalAnswer(observation)

  // 1. A client shown somebody else's charge. The worst thing in the vocabulary
  //    and the only one a row count cannot see.
  if (answeredWrongly(observation, hazard)) return 'wrong-response'

  // 2. Money moved with nothing recorded against it. Checked before `lost`
  //    because it is a strictly worse version of it — a lost write leaves the
  //    customer un-charged, this one leaves them charged and unrecorded.
  if (effects > charges && charges < hazard.expectedCharges) return 'orphaned'

  // 3. More effects than asked for, of either kind.
  if (charges > hazard.expectedCharges || effects > hazard.expectedGatewayEffects) return 'duplicate'

  // 4. Fewer. Which failure it is depends on what the client was told.
  if (charges < hazard.expectedCharges || effects < hazard.expectedGatewayEffects) {
    if (answer !== null && isSuccess(answer.status)) return 'lost'
    if (answer !== null && answer.status === 409) return 'blocked'

    // A *replayed* failure with no effect is not a refusal, however much its
    // status code looks like one. It means the service recorded the error
    // against the key and will now serve that error to every future retry: the
    // operation has been made permanently impossible, and the client is being
    // told to give up on a charge nobody ever made. `retry-after-decline` is
    // the row, and four of the eight strategies are on it — caching the
    // failure alongside the success is the natural thing to write and it turns
    // one declined attempt into a dead key.
    if (answer !== null && answer.replayed) return 'lost'

    // Nobody was told it worked and nobody was told to wait — every delivery
    // either died or was refused, so the operation is simply undone and the
    // client knows. That is a refusal, and whether refusing was *correct* is
    // `handled`'s question rather than this one's.
    return 'rejected'
  }

  // 5. The effects are right. The remaining question is whether the answer is.
  if (answer === null) {
    // Every delivery died. The world is correct and no client knows it, which
    // is the one case where the effects being right is not reassuring.
    return 'lost'
  }

  if (!isSuccess(answer.status)) return answer.status === 409 ? 'blocked' : 'rejected'

  return 'safe'
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
