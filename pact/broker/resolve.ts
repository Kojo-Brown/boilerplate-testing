/**
 * Where the broker comes from, and what happens when there isn't one.
 *
 * A pact broker is a Rails application with a relational database behind it.
 * It cannot be started in-process the way `containers/` starts Postgres, and
 * it is not something `pnpm test` may require — a contributor with no Docker
 * still runs every other gate in this repository, which is the rule
 * `containers/` already set and this follows.
 *
 * So the broker is resolved from the environment, and the suites that need one
 * skip themselves — loudly, with the reason — when it is absent. What that
 * costs is stated rather than hidden: `pnpm test:pact:broker` is a gate that
 * does not run on a laptop with nothing configured, and CI is where it is
 * enforced. `.github/workflows/ci.yml` runs a real `pactfoundation/pact-broker`
 * as a service container, so every cell of the matrix in `pipeline/` is
 * measured against a real broker on every pull request.
 *
 * `PACT_BROKER_BASE_URL` also means a contributor can point these suites at a
 * broker they started themselves — a `docker run`, a PactFlow account, their
 * team's — and get the same run CI gets.
 */

import { PactBrokerClient, type BrokerAuth } from './client'

/** The environment variables this module reads. Named once, used once. */
export const BROKER_ENV = {
  baseUrl: 'PACT_BROKER_BASE_URL',
  username: 'PACT_BROKER_USERNAME',
  password: 'PACT_BROKER_PASSWORD',
  token: 'PACT_BROKER_TOKEN',
} as const

/** Either a broker to use, or the sentence explaining why there is none. */
export type BrokerResolution =
  | { readonly kind: 'available'; readonly client: PactBrokerClient }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Reads credentials from the environment.
 *
 * A token wins over a username/password pair because that is the order the
 * hosted brokers document, and because a repository that has both configured
 * almost always has the pair left over from an older setup.
 */
export function authFromEnv(env: NodeJS.ProcessEnv = process.env): BrokerAuth {
  const token = env[BROKER_ENV.token]
  if (token) return { kind: 'bearer', token }

  const username = env[BROKER_ENV.username]
  const password = env[BROKER_ENV.password]
  if (username && password) return { kind: 'basic', username, password }

  return { kind: 'none' }
}

/**
 * Resolves a broker without contacting it.
 *
 * Separate from {@link resolveBroker} so the decision — "is one configured?" —
 * can be tested without a broker, which is the state most machines running
 * this suite are in.
 */
export function brokerFromEnv(env: NodeJS.ProcessEnv = process.env): BrokerResolution {
  const baseUrl = env[BROKER_ENV.baseUrl]
  if (!baseUrl) {
    return {
      kind: 'unavailable',
      reason:
        `${BROKER_ENV.baseUrl} is not set. Start a broker and point this at it — ` +
        'CI runs `pactfoundation/pact-broker` as a service container; locally, ' +
        '`docker run -p 9292:9292 pactfoundation/pact-broker` with a database ' +
        'behind it is the documented way. See pact/README.md.',
    }
  }
  return { kind: 'available', client: new PactBrokerClient(baseUrl, authFromEnv(env)) }
}

/**
 * Resolves a broker *and* checks it answers.
 *
 * The heartbeat is not ceremony. A `PACT_BROKER_BASE_URL` pointing at
 * something that is not up turns every suite below into a wall of connection
 * errors attached to whichever assertion happened to run first; one probe
 * turns it into one sentence naming the URL.
 */
export async function resolveBroker(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrokerResolution> {
  const resolution = brokerFromEnv(env)
  if (resolution.kind === 'unavailable') return resolution

  if (!(await resolution.client.heartbeat())) {
    return {
      kind: 'unavailable',
      reason:
        `${BROKER_ENV.baseUrl} is set to ${resolution.client.baseUrl} but its ` +
        'heartbeat did not answer. The broker is not up, or the URL is wrong.',
    }
  }
  return resolution
}
