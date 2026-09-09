/**
 * The derivations, checked for the property the corpus depends on: a variant
 * differs from the baseline in exactly one interaction and in nothing else.
 *
 * Without this, "the consumer added one expectation" is a claim about a
 * function nobody has looked at, and a variant that quietly dropped the
 * matching rules would make the whole `broker` column pass for the wrong
 * reason.
 */

import { describe, expect, it } from 'vitest'
import {
  CONTRACT_VARIANTS,
  LOGOUT_INTERACTION,
  PREFERENCES_INTERACTION,
  readBaselineContract,
  withAddedInteraction,
  withoutInteraction,
  type PactDocument,
} from './contracts'

const baseline = readBaselineContract()

/** Everything about a pact except its interactions. */
function envelope(pact: PactDocument): Record<string, unknown> {
  const { interactions: _interactions, ...rest } = pact
  return rest
}

function descriptions(pact: PactDocument): string[] {
  return pact.interactions.map((interaction) => interaction.description)
}

describe('The baseline contract', () => {
  it('is the document the consumer suites wrote', () => {
    expect(baseline.consumer.name).toBe('boilerplate-consumer')
    expect(baseline.provider.name).toBe('boilerplate-api')
    expect(baseline.interactions.length).toBeGreaterThan(0)
  })

  it('contains the interaction the drop variant removes', () => {
    expect(descriptions(baseline)).toContain(LOGOUT_INTERACTION)
  })
})

describe('The dropped variant', () => {
  const dropped = CONTRACT_VARIANTS.dropped(baseline)

  it('removes exactly one interaction', () => {
    expect(dropped.interactions).toHaveLength(baseline.interactions.length - 1)
    expect(descriptions(dropped)).not.toContain(LOGOUT_INTERACTION)
  })

  it('leaves every other interaction untouched', () => {
    const kept = baseline.interactions.filter((i) => i.description !== LOGOUT_INTERACTION)
    expect(dropped.interactions).toEqual(kept)
  })

  it('leaves the envelope untouched', () => {
    expect(envelope(dropped)).toEqual(envelope(baseline))
  })

  it('refuses to remove an interaction that is not there', () => {
    expect(() => withoutInteraction(baseline, 'no such interaction')).toThrow(
      /No interaction called/,
    )
  })
})

describe('The added variant', () => {
  const added = CONTRACT_VARIANTS.added(baseline)

  it('adds exactly one interaction', () => {
    expect(added.interactions).toHaveLength(baseline.interactions.length + 1)
    expect(descriptions(added)).toContain(PREFERENCES_INTERACTION)
  })

  it('leaves every existing interaction untouched', () => {
    expect(added.interactions.slice(0, baseline.interactions.length)).toEqual(baseline.interactions)
  })

  it('keeps the matching rules of the interaction it was copied from', () => {
    const template = baseline.interactions.find((i) => i.description === 'a GET request for user 1')
    const preferences = added.interactions.find((i) => i.description === PREFERENCES_INTERACTION)

    expect(preferences?.['response']).toEqual(template?.['response'])
  })

  it('points at a path the provider does not route', () => {
    const preferences = added.interactions.find((i) => i.description === PREFERENCES_INTERACTION)
    const request = preferences?.['request'] as { path: string }

    expect(request.path).toBe('/v1/users/1/preferences')
  })

  it('leaves the envelope untouched', () => {
    expect(envelope(added)).toEqual(envelope(baseline))
  })

  it('refuses to build the variant when the template interaction is gone', () => {
    const withoutTemplate = withoutInteraction(baseline, 'a GET request for user 1')
    expect(() => withAddedInteraction(withoutTemplate)).toThrow(/No interaction called/)
  })
})

describe('The baseline variant', () => {
  it('is the baseline itself', () => {
    expect(CONTRACT_VARIANTS.baseline(baseline)).toBe(baseline)
  })
})

describe('Reading a contract that is not there', () => {
  it('names the command that writes it', () => {
    expect(() => readBaselineContract('/nonexistent/pact.json')).toThrow(/pnpm pact:consumer/)
  })
})
