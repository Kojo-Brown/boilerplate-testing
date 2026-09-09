/**
 * Runs one cell of the matrix: one wiring, one scenario, against a real
 * broker and a real provider.
 *
 * Nothing here is simulated. A broker cell publishes a contract over HTTP,
 * starts the provider build the scenario names, runs the pact verifier against
 * it, publishes the result, records a deployment and asks `can-i-deploy`. What
 * a cell reports is what those calls did.
 *
 * ---------------------------------------------------------------------------
 * The seeded history, and why every broker cell pays for one
 * ---------------------------------------------------------------------------
 * "Pending" is not a property of a pact, it is a property of a pact *the
 * provider has not yet verified on its main branch*. A broker with no history
 * has nothing but pending pacts, so `enablePending` would swallow every
 * failure and the `broker` / `broker-pending` columns would differ everywhere
 * for a reason that has nothing to do with the feature.
 *
 * So each broker cell first publishes the baseline contract and verifies it
 * with a correct provider, both on `main` — the state any real integration is
 * in before somebody changes something. It costs one extra verification per
 * cell (~200ms) and it is the difference between measuring pending pacts and
 * measuring an empty database.
 */

import { PACT_CONSUMER, PACT_PROVIDER } from '../pact.config'
import type { PactBrokerClient } from '../broker/client'
import { CORRECT } from '../provider/app'
import { verifyProvider, type VerificationOutcome } from '../provider/verify'
import { CONTRACT_VARIANTS, readBaselineContract, type PactDocument } from './contracts'
import type { Scenario } from './scenarios'
import { verdictFor, type Cell, type Stage, type Strategy } from './strategies'

/** The environment the deploy gate asks about. */
export const DEPLOY_ENVIRONMENT = 'production'

/** The branch both sides build on. Selectors match on it. */
export const MAIN_BRANCH = 'main'

/** Versions. Distinct per cell so a leaked record from the last one is visible. */
const BASELINE_CONSUMER_VERSION = 'consumer-1'
const BASELINE_PROVIDER_VERSION = 'provider-1'
const CHANGED_CONSUMER_VERSION = 'consumer-2'
const CHANGED_PROVIDER_VERSION = 'provider-2'

/** Writes a contract variant to a temp file and hands back the path. */
export interface ContractFiles {
  /** The contract as the provider's repo last copied it. */
  readonly stale: string
  /** The contract as the consumer publishes it in this scenario. */
  readonly fresh: string
}

/** A verification outcome reduced to "did the provider's build go red". */
function providerBuildRed(outcome: VerificationOutcome): boolean {
  if (outcome.kind === 'errored') {
    // Not a contract failure. Scoring it as one would credit the wiring with a
    // detection it did not make, which is the one way this harness can lie.
    throw new Error(`Verifier could not run: ${outcome.message}`)
  }
  return outcome.kind === 'failed'
}

/** Runs a file-based cell. No broker is involved, and none is contacted. */
async function runFileCell(
  strategy: Strategy,
  scenario: Scenario,
  files: ContractFiles,
): Promise<{ stage: Stage; detail: string }> {
  const path = strategy.currentContract ? files.fresh : files.stale
  const outcome = await verifyProvider({
    source: { kind: 'files', paths: [path] },
    flags: scenario.flags,
  })

  if (providerBuildRed(outcome)) {
    return { stage: 'provider-ci', detail: 'provider verification failed' }
  }
  // There is no later stage to reach: `hasDeployGate` is false for both file
  // strategies, so a green verification is the end of the pipeline.
  return { stage: 'none', detail: 'provider verification passed; no deploy gate exists' }
}

/** Runs a broker-based cell against the real broker. */
async function runBrokerCell(
  broker: PactBrokerClient,
  strategy: Strategy,
  scenario: Scenario,
  baseline: PactDocument,
  changed: PactDocument,
): Promise<{ stage: Stage; detail: string }> {
  // A broker is stateful, and every cell publishes under the same two names.
  // Deleting both pacticipants is the reset; see `deletePacticipant`.
  await broker.deletePacticipant(PACT_CONSUMER)
  await broker.deletePacticipant(PACT_PROVIDER)

  const publish = (version: string, content: PactDocument) =>
    broker.publishContracts({
      consumerName: PACT_CONSUMER,
      consumerVersion: version,
      branch: MAIN_BRANCH,
      contracts: [
        { consumerName: PACT_CONSUMER, providerName: PACT_PROVIDER, content },
      ],
    })

  const verifyFromBroker = (providerVersion: string, flags = scenario.flags) =>
    verifyProvider({
      source: {
        kind: 'broker',
        brokerUrl: broker.baseUrl,
        auth: broker.auth,
        // `mainBranch` rather than `latest`: it is what a provider's CI should
        // ask for, and it is the selector that makes the pending calculation
        // mean anything.
        selectors: [{ mainBranch: true }, { deployedOrReleased: true }],
        enablePending: strategy.enablePending,
        publishResults: true,
      },
      flags,
      providerVersion,
      providerBranch: MAIN_BRANCH,
    })

  // ---- history: the integration was working before anybody changed anything
  await publish(BASELINE_CONSUMER_VERSION, baseline)
  const seeded = await verifyFromBroker(BASELINE_PROVIDER_VERSION, CORRECT)
  if (providerBuildRed(seeded)) {
    throw new Error(
      'The baseline contract does not verify against the correct provider. ' +
        'Every cell is measured relative to that, so the corpus is unusable until it does.',
    )
  }
  await broker.recordDeployment(PACT_CONSUMER, BASELINE_CONSUMER_VERSION, DEPLOY_ENVIRONMENT)
  await broker.recordDeployment(PACT_PROVIDER, BASELINE_PROVIDER_VERSION, DEPLOY_ENVIRONMENT)

  // ---- the consumer publishes its new contract
  await publish(CHANGED_CONSUMER_VERSION, changed)

  // ---- and, in the scenarios where it got there first, deploys it
  //
  // A consumer version cannot honestly be deployed until the provider it is
  // deployed against has verified its contract, so the verification comes
  // first and runs against the *unchanged* provider — which is what the
  // provider was at the moment the consumer shipped. Recording the deployment
  // supersedes the baseline record for the same application instance, which is
  // what makes `deployedOrReleased` stop selecting the old pact.
  //
  // It re-verifies as `provider-1`, the version already deployed, rather than
  // inventing a new one, and that detail decides the cell. This is what a
  // broker webhook does when a contract requiring verification is published:
  // it triggers the provider's build for the code that is already running. Run
  // it under a fresh version instead and the deploy gate correctly refuses —
  // "there is no verified pact between consumer-2 and the version of the
  // provider currently in production" — because there genuinely would not be
  // one. The first draft of this file did exactly that and read as the broker
  // false-alarming on a safe retirement.
  if (scenario.deployed === 'changed') {
    const beforeProviderChanged = await verifyFromBroker(BASELINE_PROVIDER_VERSION, CORRECT)
    if (providerBuildRed(beforeProviderChanged)) {
      throw new Error(
        `${scenario.id} deploys the changed consumer, but the unchanged provider does not ` +
          'satisfy its contract — so the deployment it models could not have happened.',
      )
    }
    await broker.recordDeployment(PACT_CONSUMER, CHANGED_CONSUMER_VERSION, DEPLOY_ENVIRONMENT)
  }

  // ---- the change under test
  const outcome = await verifyFromBroker(CHANGED_PROVIDER_VERSION)
  if (providerBuildRed(outcome)) {
    return { stage: 'provider-ci', detail: 'provider verification failed' }
  }

  // ---- the deploy gate, asked of both sides
  //
  // Each team gates its own release, so the pipeline is blocked if either
  // answer is no. Asking only about the provider would miss exactly the
  // scenario `broker-pending` exists to move: a consumer's unverified
  // expectation leaves the provider free to deploy and the consumer stuck,
  // which is the correct assignment of the problem and invisible if only one
  // side is asked.
  const answers = await Promise.all([
    broker.canIDeploy(PACT_PROVIDER, CHANGED_PROVIDER_VERSION, DEPLOY_ENVIRONMENT),
    broker.canIDeploy(PACT_CONSUMER, CHANGED_CONSUMER_VERSION, DEPLOY_ENVIRONMENT),
  ])
  const blocked = answers.find((answer) => !answer.deployable)
  return blocked
    ? { stage: 'deploy-gate', detail: blocked.reason }
    : { stage: 'none', detail: answers[0]?.reason ?? '' }
}

/** Runs one cell and scores it. */
export async function runCell(
  broker: PactBrokerClient,
  strategy: Strategy,
  scenario: Scenario,
  files: ContractFiles,
  contracts: { readonly baseline: PactDocument; readonly changed: PactDocument },
): Promise<Cell> {
  const { stage, detail } = strategy.usesBroker
    ? await runBrokerCell(broker, strategy, scenario, contracts.baseline, contracts.changed)
    : await runFileCell(strategy, scenario, files)

  return {
    strategy: strategy.id,
    scenario: scenario.id,
    stage,
    verdict: verdictFor(scenario.truth, stage),
    detail,
  }
}

/** The contract pair a scenario needs: what was copied, and what is current. */
export function contractsFor(scenario: Scenario): {
  baseline: PactDocument
  changed: PactDocument
} {
  const baseline = readBaselineContract()
  return { baseline, changed: CONTRACT_VARIANTS[scenario.contract](baseline) }
}
