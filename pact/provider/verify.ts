/**
 * One way to run provider verification, used by the verify suite and by
 * `pipeline/`.
 *
 * The two callers differ in exactly two things — where the pacts come from and
 * whether the result is published — and those are the two things the pipeline
 * study is about, so they are parameters here rather than two copies of the
 * `Verifier` setup.
 *
 * The return type is the other reason this exists. `verifyProvider()` throws
 * on a contract failure, and a study that runs 44 verifications and expects
 * many of them to fail needs the failure as a value, not as an exception —
 * with the distinction between "the contract does not hold" and "the verifier
 * could not run" preserved, because a study that scores a crashed run as a
 * detection is measuring its own harness.
 */

import { Verifier, type VerifierOptions } from '@pact-foundation/pact'
import type { BrokerAuth } from '../broker/client'
import { PACT_LOG_LEVEL, PACT_PROVIDER } from '../pact.config'
import { CORRECT, startProvider, type ProviderFlags } from './app'
import { stateHandlers } from './states'

/** Where the verifier gets its pacts. */
export type PactSource =
  | { readonly kind: 'files'; readonly paths: readonly string[] }
  | {
      readonly kind: 'broker'
      readonly brokerUrl: string
      /**
       * Credentials, passed explicitly.
       *
       * They have to be: {@link BROKER_ENV} unsets `PACT_BROKER_USERNAME` and
       * friends for the duration of the run, so a broker behind auth would get
       * a 401 if this were left to the environment. That is the price of
       * making a file-sourced run mean what it says, and it is the right way
       * round — configuration that is passed can be read in the call.
       */
      readonly auth: BrokerAuth
      /** Consumer version selectors. Empty means "the broker's default". */
      readonly selectors: readonly ConsumerVersionSelector[]
      /** Verify pacts in `pending` state without failing the build. */
      readonly enablePending: boolean
      /** Publish the result back, so `can-i-deploy` can read it. */
      readonly publishResults: boolean
    }

/**
 * A consumer version selector.
 *
 * Narrower than the broker accepts on purpose: these four cover every
 * selection `pipeline/` compares, and a selector this repository never sends
 * is a field nothing checks.
 */
export interface ConsumerVersionSelector {
  readonly mainBranch?: boolean
  readonly deployedOrReleased?: boolean
  readonly branch?: string
  readonly latest?: boolean
}

/** What one verification run did. */
export type VerificationOutcome =
  | { readonly kind: 'passed' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'errored'; readonly message: string }

/** Everything a run needs beyond the provider itself. */
export interface VerifyRequest {
  readonly source: PactSource
  /** The provider build under test. Defaults to the correct one. */
  readonly flags?: ProviderFlags
  /** The provider version being verified. Required to publish results. */
  readonly providerVersion?: string
  /** The provider's branch, so the broker can scope the result. */
  readonly providerBranch?: string
}

/**
 * A verification failure the FFI reports as a thrown `Error` whose message is
 * always this string, with the detail on stdout. Matching on it is how a
 * contract failure is told apart from a broker that refused the connection —
 * the typo is upstream's, in `nativeVerifier.ts`, and is matched as written.
 */
const FFI_VERIFICATION_FAILED = 'Verfication failed'

/**
 * Ambient HTTP proxy settings, unset for the duration of a verification.
 *
 * Not defensive tidying. The provider these runs verify listens on 127.0.0.1,
 * and the pact FFI's HTTP client reads `HTTPS_PROXY` from the environment;
 * behind a proxy that answers CONNECT with 403 — a corporate one, or the
 * sandbox this repository's scheduled agent runs in — *every* interaction
 * fails with `403` and a `text/plain` body, which reads as a provider that has
 * grown an authorization layer rather than as a request that never arrived.
 * `no_proxy` already lists 127.0.0.1 and does not help.
 */
const PROXY_ENV = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

/**
 * Broker settings, unset for the duration of a *file* verification.
 *
 * This one is not a workaround for the environment, it is a workaround for the
 * verifier, and it is the single most surprising thing in this directory.
 *
 * `pact-core`'s argument mapper reads
 * `opts.pactBrokerUrl || process.env['PACT_BROKER_BASE_URL']`
 * (`verifier/argumentMapper/arguments.js`) and, if either is set, adds a
 * *broker source* to the verification. There is no way to say "this run has no
 * broker": passing only `pactUrls` is not enough, because the environment
 * variable is consulted independently. So on any machine where
 * `PACT_BROKER_BASE_URL` is exported — which is every CI job that does
 * contract testing at all — `verify these files` silently means `verify these
 * files **and** whatever the broker currently holds for this provider`.
 *
 * It is not a hypothetical. It is what made the `files-*` columns of
 * `pipeline/`'s matrix wrong in a way that looked like flakiness: a
 * file-verification cell was quiet run alone and red in the full matrix,
 * because by then earlier cells had published pacts to the broker and those
 * were being verified too. `verify.test.ts` pins the behaviour so it cannot
 * come back if this is ever refactored.
 */
const BROKER_ENV = [
  'PACT_BROKER_BASE_URL',
  'PACT_BROKER_USERNAME',
  'PACT_BROKER_PASSWORD',
  'PACT_BROKER_TOKEN',
  'PACT_BROKER_PUBLISH_VERIFICATION_RESULTS',
] as const

/**
 * Runs `fn` with `keys` unset, restoring them afterwards.
 *
 * Scoped as narrowly as it can be: restored in a `finally`, and only around
 * the verifier call. Exported because `verify.test.ts` checks it restores.
 */
export async function withEnvUnset<T>(
  keys: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>()
  for (const key of keys) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Builds the `Verifier` options for a source. Split out so it is testable. */
export function verifierOptions(
  request: VerifyRequest,
  providerBaseUrl: string,
  handlers: Record<string, unknown>,
): VerifierOptions {
  const base = {
    provider: PACT_PROVIDER,
    providerBaseUrl,
    logLevel: PACT_LOG_LEVEL,
    stateHandlers: handlers,
  } as unknown as VerifierOptions

  if (request.source.kind === 'files') {
    return { ...base, pactUrls: [...request.source.paths] }
  }

  const { brokerUrl, selectors, enablePending, publishResults, auth } = request.source
  const credentials =
    auth.kind === 'basic'
      ? { pactBrokerUsername: auth.username, pactBrokerPassword: auth.password }
      : auth.kind === 'bearer'
        ? { pactBrokerToken: auth.token }
        : {}
  return {
    ...base,
    pactBrokerUrl: brokerUrl,
    ...credentials,
    // Without selectors the broker falls back to "the latest pact for this
    // provider", which is a different question from the one a pipeline asks.
    ...(selectors.length > 0 ? { consumerVersionSelectors: [...selectors] } : {}),
    enablePending,
    publishVerificationResult: publishResults,
    ...(request.providerVersion ? { providerVersion: request.providerVersion } : {}),
    ...(request.providerBranch ? { providerVersionBranch: request.providerBranch } : {}),
  } as unknown as VerifierOptions
}

/**
 * Starts the provider, verifies it, stops it, and reports what happened.
 *
 * Always starts its own provider: a study comparing eight provider builds
 * needs each one on its own port, and reusing a long-lived provider between
 * cells would let one cell's state reach the next.
 */
export async function verifyProvider(request: VerifyRequest): Promise<VerificationOutcome> {
  const provider = await startProvider(request.flags ?? CORRECT)
  // A broker-sourced run passes its broker URL explicitly, so unsetting the
  // environment costs it nothing; a file-sourced run must have it unset or it
  // is not file-sourced at all. Both, therefore, unconditionally.
  const scrub = [...PROXY_ENV, ...BROKER_ENV]
  try {
    const options = verifierOptions(request, provider.url, stateHandlers(provider.store))
    await withEnvUnset(scrub, () => new Verifier(options).verifyProvider())
    return { kind: 'passed' }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes(FFI_VERIFICATION_FAILED)
      ? { kind: 'failed', message }
      : { kind: 'errored', message }
  } finally {
    await provider.stop()
  }
}
