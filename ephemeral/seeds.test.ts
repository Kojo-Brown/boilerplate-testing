// @vitest-environment node
/**
 * The two places a preview environment gets its data from.
 *
 * The behaviours that carry cells are the last two describes: a write under
 * `shared` is visible to a pull request that did not make it, and a shared
 * dataset stays at the base schema however many migrations the previews
 * contain. Everything above them is the contract those two rest on.
 */

import { describe, expect, it } from 'vitest'

import { BASE_SCHEMA, Seeds, SEED_ROWS } from './seeds.ts'

describe('the seed fixture', () => {
  it('uses addresses in the reserved .invalid domain, so nothing here can be mistaken for real data', () => {
    const addresses = Object.values(SEED_ROWS).filter((value) => value.includes('@'))

    expect(addresses.length).toBeGreaterThan(0)
    for (const address of addresses) expect(address.endsWith('@example.invalid')).toBe(true)
  })
})

describe('a per-environment dataset', () => {
  it('starts every environment from the same fixture', () => {
    const seeds = new Seeds()

    seeds.provision(1, 'per-env', BASE_SCHEMA)

    expect(seeds.datasetFor(1).rows).toEqual(SEED_ROWS)
  })

  it('is seeded at the schema the deployed commit expects, migration and all', () => {
    const seeds = new Seeds()

    seeds.provision(1, 'per-env', 'v2')

    expect(seeds.schemaFor(1)).toBe('v2')
  })

  it('keeps one pull request writes out of another', () => {
    const seeds = new Seeds()
    seeds.provision(1, 'per-env', BASE_SCHEMA)
    seeds.provision(3, 'per-env', BASE_SCHEMA)

    seeds.write(3, 'user:1', 'mock-tampered@example.invalid')

    expect(seeds.foreignRows(1)).toEqual([])
    expect(seeds.datasetFor(1).rows['user:1']).toBe(SEED_ROWS['user:1'])
  })

  it('re-seeds on redeploy, so a second push starts from the fixture again', () => {
    const seeds = new Seeds()
    seeds.provision(1, 'per-env', BASE_SCHEMA)
    seeds.write(1, 'user:1', 'mock-edited@example.invalid')

    seeds.provision(1, 'per-env', BASE_SCHEMA)

    expect(seeds.datasetFor(1).rows['user:1']).toBe(SEED_ROWS['user:1'])
  })

  it('goes back to the shared dataset once the environment is released', () => {
    const seeds = new Seeds()
    seeds.provision(1, 'per-env', 'v2')

    seeds.release(1)

    expect(seeds.schemaFor(1)).toBe(BASE_SCHEMA)
  })
})

describe('a shared dataset', () => {
  it('routes every environment to the same rows', () => {
    const seeds = new Seeds()
    seeds.provision(1, 'shared', BASE_SCHEMA)
    seeds.provision(3, 'shared', BASE_SCHEMA)

    expect(seeds.datasetFor(1)).toBe(seeds.datasetFor(3))
  })

  /** `cross-pr-write`, at the level of the data. */
  it("shows one pull request the rows another pull request's test run wrote", () => {
    const seeds = new Seeds()
    seeds.provision(1, 'shared', BASE_SCHEMA)
    seeds.provision(3, 'shared', BASE_SCHEMA)

    seeds.write(3, 'user:1', 'mock-tampered@example.invalid')

    expect(seeds.foreignRows(1)).toEqual(['user:1'])
  })

  it("does not count a pull request's own writes as somebody else's", () => {
    const seeds = new Seeds()
    seeds.provision(1, 'shared', BASE_SCHEMA)

    seeds.write(1, 'user:1', 'mock-edited@example.invalid')

    expect(seeds.foreignRows(1)).toEqual([])
  })

  /** `migration-in-pr`, at the level of the data. */
  it('stays at the base schema however many previews contain a migration', () => {
    const seeds = new Seeds()

    seeds.provision(1, 'shared', 'v2')
    seeds.provision(3, 'shared', 'v3')

    expect(seeds.schemaFor(1)).toBe(BASE_SCHEMA)
    expect(seeds.schemaFor(3)).toBe(BASE_SCHEMA)
  })
})
