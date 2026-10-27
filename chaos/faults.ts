/**
 * The fault catalogue: eight things that go wrong between a service and the
 * dependency it calls, each one produced for real rather than described.
 *
 * ---------------------------------------------------------------------------
 * Why these eight
 * ---------------------------------------------------------------------------
 * The SPEC item names three categories — latency, errors, dependency outages —
 * and the obvious reading of it is three faults. Three faults is not enough to
 * say anything, because the interesting differences between resilience
 * policies live *inside* each category rather than between them:
 *
 *   - Latency splits on **where** the delay is. A response whose headers are
 *     late and a response whose body stalls after the headers arrive are the
 *     same event to a stopwatch and completely different events to a client,
 *     and `policies.ts` has two timeout wirings that agree on the first and
 *     disagree on the second. One fault cannot separate them.
 *   - Errors split on **who** reports them, and on **whether they heal**. A 500
 *     is the dependency saying no; a truncated JSON body is the dependency
 *     saying yes and lying about it, which a policy keyed on `res.ok` cannot
 *     see; and a 500 that goes away on the next attempt is the only fault in
 *     the catalogue a retry can actually recover from.
 *   - Outages split on **when** the connection dies. Refused before anything
 *     was sent, reset after a body was half-delivered, and accepted but never
 *     answered are three different observations, and only the third is a
 *     timeout's problem.
 *
 * So: two latency faults, three error faults, three outage faults, and a control.
 * Every one of them is a real socket doing a real thing in `origin.ts`.
 *
 * ---------------------------------------------------------------------------
 * `healthy` is not padding
 * ---------------------------------------------------------------------------
 * A chaos suite with no control cannot tell "the policy survived the fault"
 * from "the policy never reached the dependency". The `healthy` column is how
 * every other column is known to be measuring something, and it is also the
 * one column where a *failure* is a bug in the harness rather than a finding.
 */

/** The three things the SPEC item asks for, used to group the catalogue. */
export const CATEGORIES = ['control', 'latency', 'error', 'outage'] as const

export type Category = (typeof CATEGORIES)[number]

export const FAULT_IDS = [
  'healthy',
  'slow-headers',
  'slow-body',
  'error-500',
  'transient-500',
  'malformed-body',
  'connection-refused',
  'reset-mid-body',
  'black-hole',
] as const

export type FaultId = (typeof FAULT_IDS)[number]

export interface Fault {
  readonly id: FaultId
  readonly category: Category
  /** What the origin does, in the terms a packet capture would use. */
  readonly injects: string
  /** Why this fault is in the catalogue and not folded into its neighbour. */
  readonly why: string
}

export const FAULTS: readonly Fault[] = [
  {
    id: 'healthy',
    category: 'control',
    injects: 'answers 200 with a well-formed body, immediately',
    why: 'The control. Without it, a policy that fails to reach the dependency at all scores the same as one that survived everything.',
  },
  {
    id: 'slow-headers',
    category: 'latency',
    injects: 'waits past the budget, then sends status line, headers and body together',
    why: 'The latency fault everybody writes: the dependency is simply slow to answer. Every timeout wiring catches it, which is exactly why a suite containing only this fault certifies all of them.',
  },
  {
    id: 'slow-body',
    category: 'latency',
    injects: 'sends 200 and headers at once, then stalls mid-body past the budget before finishing it',
    why: 'The latency fault nobody writes, and the only fault in this catalogue that separates a timeout covering the whole operation from one covering only the request. Headers arriving on time is what makes it invisible: a stopwatch around `fetch()` has already stopped.',
  },
  {
    id: 'error-500',
    category: 'error',
    injects: 'answers 500 with a well-formed JSON error body',
    why: 'The dependency reporting its own failure, in the channel a client is most likely to be reading. The only fault here that a policy keyed purely on `res.ok` can see.',
  },
  {
    id: 'transient-500',
    category: 'error',
    injects: 'answers 500 to the first request of any call and 200 to every later one',
    why: 'The only fault here that heals, and the catalogue is incomplete without it. Every other fault is persistent for the length of a series, which means no cell can show a retry *recovering* anything — only the extra requests it costs. A chaos suite built from persistent faults alone measures retry amplification and calls it retry coverage, and it is the only column in the matrix where a retrying wiring outscores the timeout it is built on.',
  },
  {
    id: 'malformed-body',
    category: 'error',
    injects: 'answers 200, `content-type: application/json`, and a body that stops mid-token',
    why: 'The dependency failing while claiming success. Status is 200, `res.ok` is true, and the failure surfaces from the parser — which is after the point most retry policies have decided the call went fine.',
  },
  {
    id: 'connection-refused',
    category: 'outage',
    injects: 'nothing is listening on the port at all',
    why: 'The dependency being down rather than broken: the connection never opens, so there is no status, no body and no latency to measure. Measured against a port that was bound and then closed, not a port picked for being unlikely — a guessed port can be in use, and a reserved one answers with a different error.',
  },
  {
    id: 'reset-mid-body',
    category: 'outage',
    injects: 'sends 200, headers and part of a body, then destroys the socket',
    why: 'The dependency dying with the call in flight — a deploy, an OOM kill, a load balancer draining. It is the fault that proves a retry policy keyed on status codes is keyed on the wrong thing: there is no status to key on, because the status was 200.',
  },
  {
    id: 'black-hole',
    category: 'outage',
    injects: 'accepts the connection and never writes a byte',
    why: 'The outage with no error in it. Nothing is refused and nothing is reset, so the only thing that ends the call is the caller giving up — which makes this the one fault where a timeout is not an optimisation but the entire defence.',
  },
]

const BY_ID = new Map(FAULTS.map((fault) => [fault.id, fault]))

export function fault(id: FaultId): Fault {
  const found = BY_ID.get(id)

  if (found === undefined) throw new Error(`unknown fault: ${id}`)

  return found
}

/** The faults in a category, in catalogue order. */
export const faultsIn = (category: Category): readonly Fault[] =>
  FAULTS.filter((candidate) => candidate.category === category)
