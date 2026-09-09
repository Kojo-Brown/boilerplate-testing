/**
 * The corpus: twelve things that happen to a pair of teams, each with a stated
 * ground truth about whether the consumer actually breaks.
 *
 * ---------------------------------------------------------------------------
 * Why ground truth, and not just "did it go red"
 * ---------------------------------------------------------------------------
 * A detection matrix over breaking changes only measures how *loud* a wiring
 * is, and the loudest possible wiring — fail everything — scores perfectly. It
 * is the same trap `snapshot/README.md` documents for snapshots: the number
 * that matters is not the detection rate but the signal rate, which needs
 * changes that break nothing in the corpus alongside the ones that do.
 *
 * So three of the twelve are `safe`. Two of those are the ones worth having:
 *
 *   - `EXTRA_FIELD_ADDED`. Consumer-driven contract testing is supposed to let
 *     a provider add a field without asking anybody. A wiring that goes red
 *     here has made every provider change a negotiation, which is the failure
 *     mode teams abandon contract testing over.
 *   - `LOGOUT_RETIRED`. The consumer stopped calling logout, deployed, and the
 *     provider then removed the route. Nothing is broken. Whether a wiring
 *     knows that is the one question a file on a disk cannot answer, and it is
 *     a false alarm rather than a miss — the error class detection-rate tables
 *     never show.
 *
 * ---------------------------------------------------------------------------
 * Both halves change
 * ---------------------------------------------------------------------------
 * A scenario names a provider build (flags on `provider/app.ts`), a consumer
 * contract (a variant in `contracts.ts`), and which consumer version is
 * actually deployed. Most scenarios move one and hold the rest, which is what
 * makes them single-behaviour; the two `LOGOUT_RETIRED*` rows deliberately move
 * both sides, because a retirement is one event from the teams' point of view
 * and modelling it as two would measure something nobody does.
 *
 * That pair is the same retirement in the two possible orders, and they are in
 * the corpus together on purpose: they are identical in every field except
 * `deployed`, so any column that scores them the same is a column that cannot
 * see deployment order.
 */

import { CORRECT, type ProviderFlags } from '../provider/app'
import type { ContractVariant } from './contracts'

/** Whether the pairing genuinely breaks the consumer. */
export type GroundTruth = 'breaks' | 'safe'

/** Which consumer version is actually running in production. */
export type DeployedConsumer = 'baseline' | 'changed'

/** One row of the corpus. */
export interface Scenario {
  /** Stable id. Used as the row key everywhere, README included. */
  readonly id: string
  /** One line: what the team did. */
  readonly summary: string
  /** The provider build. */
  readonly flags: ProviderFlags
  /** The contract the consumer has published. */
  readonly contract: ContractVariant
  /**
   * Which consumer version production is running when the provider builds.
   *
   * Publishing a contract and deploying the code that relies on it are two
   * events, and the gap between them is where retirements go wrong. It took a
   * red cell to notice this axis was missing: `LOGOUT_RETIRED` was written as
   * "the consumer stopped calling logout and the provider removed the route",
   * scored `safe`, and came back a false alarm in all four columns — correctly,
   * because the consumer *still deployed in production* was calling it. The
   * scenario was under-specified, not the wiring wrong.
   *
   * So it is a field, and the corpus carries both orderings of the same
   * retirement. Only the broker columns can read it: a pact file has no idea
   * what is deployed.
   */
  readonly deployed: DeployedConsumer
  /** Does this pairing break the consumer that is actually running? */
  readonly truth: GroundTruth
}

/** The provider build with exactly one flag set. */
function provider(flag: keyof ProviderFlags): ProviderFlags {
  return { ...CORRECT, [flag]: true }
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'NOTHING_CHANGED',
    summary: 'Neither team changed anything.',
    flags: CORRECT,
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'safe',
  },
  {
    id: 'USER_ROLE_REMOVED',
    summary: 'Provider dropped `role` from the user response.',
    flags: provider('omitUserRole'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'CREATED_AT_RENAMED',
    summary: 'Provider renamed `createdAt` to `created_at`.',
    flags: provider('snakeCaseCreatedAt'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'USER_ID_STRINGIFIED',
    summary: 'Provider started serialising `id` as a string.',
    flags: provider('stringifyUserId'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'CREATE_STATUS_CHANGED',
    summary: 'Provider answers `POST /v1/users` with 200 rather than 201.',
    flags: provider('createUserReturns200'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'ROLE_VALUE_RENAMED',
    summary: "Provider emits `role: 'member'`, outside the consumer's enum.",
    flags: provider('renameUserRoleValue'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'SCOPE_HEADER_REQUIRED',
    summary: 'Provider now requires an `X-Scope` header no consumer sends.',
    flags: provider('requireScopeHeader'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'LOGOUT_ROUTE_REMOVED',
    summary: 'Provider removed `POST /v1/auth/logout`; the consumer still calls it.',
    flags: provider('removeLogoutRoute'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'EXTRA_FIELD_ADDED',
    summary: 'Provider added a field nobody asked for.',
    flags: provider('extraUserField'),
    contract: 'baseline',
    deployed: 'baseline',
    truth: 'safe',
  },
  {
    id: 'CONSUMER_ADDED_EXPECTATION',
    summary: 'Consumer published a contract for an endpoint the provider has not built.',
    flags: CORRECT,
    contract: 'added',
    deployed: 'baseline',
    truth: 'breaks',
  },
  {
    id: 'LOGOUT_RETIRED',
    summary:
      'Consumer stopped calling logout, deployed, and then the provider removed the route.',
    flags: provider('removeLogoutRoute'),
    contract: 'dropped',
    deployed: 'changed',
    truth: 'safe',
  },
  {
    id: 'LOGOUT_RETIRED_EARLY',
    summary:
      'Same retirement, but the provider removed the route before the new consumer reached production.',
    flags: provider('removeLogoutRoute'),
    contract: 'dropped',
    deployed: 'baseline',
    truth: 'breaks',
  },
]
