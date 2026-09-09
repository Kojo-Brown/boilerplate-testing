/**
 * The four ways a team wires contract testing, and the vocabulary for what
 * each one does when something changes.
 *
 * ---------------------------------------------------------------------------
 * Why `files-fresh` is in here
 * ---------------------------------------------------------------------------
 * The usual comparison is "pact files in the repo" against "a broker", and it
 * is rigged: the file version is always described as stale, so the broker wins
 * a race against a strawman. The honest comparison needs the steel-man — a
 * team that re-copies the pact into the provider's build every time, from an
 * artefact or a submodule — because if the broker's advantage is detection
 * then `files-fresh` should be strictly worse, and if it is not, the advantage
 * is somewhere else and the README should say where.
 *
 * So the file approach appears twice, differing only in whether the document
 * the provider verifies is the current one. Everything else about the two is
 * identical, which is what makes the pair a measurement of staleness rather
 * than of anything else.
 */

/** The four wirings. */
export type StrategyId = 'files-stale' | 'files-fresh' | 'broker' | 'broker-pending'

/**
 * The stage of the pipeline that goes red, if any.
 *
 * Ordered from earliest to latest, which is also cheapest to most expensive:
 * a provider build that fails costs a rerun, and a deploy gate that fails
 * costs a release window. `none` is last and is not automatically good — for a
 * scenario whose ground truth is `breaks`, `none` is the change reaching
 * production.
 */
export type Stage = 'provider-ci' | 'deploy-gate' | 'none'

/** What a strategy is capable of. */
export interface Strategy {
  readonly id: StrategyId
  /** One line, for the README table and for failure messages. */
  readonly summary: string
  /** Does the provider fetch pacts from a broker rather than from disk? */
  readonly usesBroker: boolean
  /**
   * Does the provider verify the contract as it is *now*?
   *
   * False only for `files-stale`, where the document is whatever was last
   * copied into the provider's repository. This is the only axis on which the
   * two file strategies differ.
   */
  readonly currentContract: boolean
  /**
   * Are unverified pacts reported without failing the provider's build?
   *
   * The broker's answer to "a consumer's new expectation should not break a
   * provider build the provider author did not cause".
   */
  readonly enablePending: boolean
  /**
   * Is there a deploy gate at all?
   *
   * False for both file strategies, and not an oversight: `can-i-deploy` is a
   * question about what is deployed where and who verified what, and a pact
   * file on a disk holds none of that. A team on files does deploy — it just
   * has nothing to ask.
   */
  readonly hasDeployGate: boolean
}

export const STRATEGIES: readonly Strategy[] = [
  {
    id: 'files-stale',
    summary: 'Provider verifies the pact file committed in its own repo, whenever it was last copied.',
    usesBroker: false,
    currentContract: false,
    enablePending: false,
    hasDeployGate: false,
  },
  {
    id: 'files-fresh',
    summary: 'As above, but the file is re-copied from the consumer build first.',
    usesBroker: false,
    currentContract: true,
    enablePending: false,
    hasDeployGate: false,
  },
  {
    id: 'broker',
    summary: 'Consumer publishes to a broker; provider verifies by selector and publishes results.',
    usesBroker: true,
    currentContract: true,
    enablePending: false,
    hasDeployGate: true,
  },
  {
    id: 'broker-pending',
    summary: 'As above, with pending pacts enabled so a new expectation does not fail the provider.',
    usesBroker: true,
    currentContract: true,
    enablePending: true,
    hasDeployGate: true,
  },
]

/** One cell of the matrix. */
export interface Cell {
  readonly strategy: StrategyId
  readonly scenario: string
  /** The earliest stage that went red. */
  readonly stage: Stage
  /**
   * What that stage means against the scenario's ground truth.
   *
   *   - `caught`     — breaks, and something went red.
   *   - `missed`     — breaks, and nothing went red.
   *   - `quiet`      — safe, and nothing went red. The correct answer.
   *   - `false-alarm`— safe, and something went red.
   */
  readonly verdict: 'caught' | 'missed' | 'quiet' | 'false-alarm'
  /** The broker's or the verifier's own sentence, when there was one. */
  readonly detail: string
}

/** Scores one cell. Split out so `matrix.test.ts` can check the scoring too. */
export function verdictFor(truth: 'breaks' | 'safe', stage: Stage): Cell['verdict'] {
  if (truth === 'breaks') return stage === 'none' ? 'missed' : 'caught'
  return stage === 'none' ? 'quiet' : 'false-alarm'
}
