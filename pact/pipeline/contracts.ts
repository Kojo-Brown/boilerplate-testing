/**
 * Consumer contract variants, derived from the real pact rather than written.
 *
 * Two of the scenarios in `scenarios.ts` are consumer-side: the consumer adds
 * an expectation, or drops one. Modelling those needs a *second* pact
 * document, and the tempting way to get one is to write it out by hand.
 *
 * That does not survive contact with the thing being measured. A hand-written
 * pact drifts from the one the consumer suites actually produce — matchers
 * fall behind, the pact specification version fossilises — until the study is
 * comparing wirings over a document no consumer would emit. Worse, the whole
 * point of a consumer-side scenario is that the contract *changed by one
 * interaction*, and only a derivation can say that with a straight face.
 *
 * So every variant here is a transformation of the pact on disk, and
 * `contracts.test.ts` checks the property that makes them usable: each variant
 * differs from the baseline in exactly one interaction, and in nothing else.
 */

import { readFileSync } from 'node:fs'
import { CONSUMER_PACT_FILE } from '../pact.config'

/** The parts of a pact document this module reads. */
export interface PactDocument {
  readonly consumer: { readonly name: string }
  readonly provider: { readonly name: string }
  readonly interactions: readonly PactInteraction[]
  readonly metadata: Record<string, unknown>
}

/** One interaction. Opaque apart from its description. */
export interface PactInteraction {
  readonly description: string
  readonly [key: string]: unknown
}

/** Reads the pact the consumer suites wrote. Throws a sentence if absent. */
export function readBaselineContract(path: string = CONSUMER_PACT_FILE): PactDocument {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(
      `No pact at ${path}. The consumer suites write it — run \`pnpm pact:consumer\` first. ` +
        'Every contract variant here is derived from it, so there is nothing to derive from.',
    )
  }
  return JSON.parse(raw) as PactDocument
}

/** The interaction the drop-scenario removes. */
export const LOGOUT_INTERACTION = 'a logout request'

/** The interaction the add-scenario introduces. */
export const PREFERENCES_INTERACTION = 'a GET request for user 1 preferences'

/** The interaction the add-scenario is modelled on. */
const TEMPLATE_INTERACTION = 'a GET request for user 1'

/** Removes one interaction by description. */
export function withoutInteraction(pact: PactDocument, description: string): PactDocument {
  const remaining = pact.interactions.filter(
    (interaction) => interaction.description !== description,
  )
  if (remaining.length === pact.interactions.length) {
    throw new Error(`No interaction called ${JSON.stringify(description)} to remove`)
  }
  return { ...pact, interactions: remaining }
}

/**
 * Adds an interaction for an endpoint the provider does not implement.
 *
 * Built by copying the `GET /v1/users/1` interaction and changing its path and
 * description — which is exactly what the consumer's next `PactV3` run would
 * emit for a new read on the same resource, matchers and all. Copying rather
 * than composing keeps the matching rules in step with whatever the real
 * contract uses today; the two edits are the whole diff.
 *
 * The provider answers this path with a 404, so the interaction is one the
 * provider genuinely cannot satisfy. That is the point: it is the shape of
 * every "the front end shipped against an endpoint we haven't built yet"
 * incident.
 */
export function withAddedInteraction(pact: PactDocument): PactDocument {
  const template = pact.interactions.find(
    (interaction) => interaction.description === TEMPLATE_INTERACTION,
  )
  if (!template) {
    throw new Error(`No interaction called ${JSON.stringify(TEMPLATE_INTERACTION)} to copy`)
  }

  const request = template['request'] as Record<string, unknown>
  const added: PactInteraction = {
    ...template,
    description: PREFERENCES_INTERACTION,
    request: { ...request, path: '/v1/users/1/preferences' },
  }

  return { ...pact, interactions: [...pact.interactions, added] }
}

/** The named contract variants, each a function of the baseline. */
export const CONTRACT_VARIANTS = {
  /** The contract as the consumer suites write it. */
  baseline: (pact: PactDocument) => pact,
  /** The consumer has started reading an endpoint that does not exist. */
  added: withAddedInteraction,
  /** The consumer has stopped calling logout. */
  dropped: (pact: PactDocument) => withoutInteraction(pact, LOGOUT_INTERACTION),
} as const

/** Which contract a scenario publishes. */
export type ContractVariant = keyof typeof CONTRACT_VARIANTS
