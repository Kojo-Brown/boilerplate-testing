// @vitest-environment node
/**
 * The deployer and its record.
 *
 * The point to hold on to while reading these: nothing in `deployer.ts` is
 * wrong, and the last describe is the one that shows why that is not enough.
 * A state file records what you created; teardown driven by it deletes what
 * you created; and the resource nobody created is still running afterwards
 * unless it happened to be nested inside something you did.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { Clock } from './clock.ts'
import { Cloud } from './cloud.ts'
import { Deployer } from './deployer.ts'
import { BASE_SCHEMA, Seeds } from './seeds.ts'

let clock: Clock
let cloud: Cloud
let seeds: Seeds
let deployer: Deployer

beforeEach(() => {
  clock = new Clock()
  cloud = new Cloud(clock.now)
  seeds = new Seeds()
  deployer = new Deployer(cloud, seeds)
})

const deploy = (overrides: { pr?: number; sha?: string; schema?: string; namespaced?: boolean } = {}): void => {
  deployer.deploy({
    pr: overrides.pr ?? 1,
    sha: overrides.sha ?? 'aaa',
    schema: overrides.schema ?? BASE_SCHEMA,
    namespaced: overrides.namespaced ?? false,
    seedPolicy: 'per-env',
  })
}

describe('a first deploy', () => {
  it('creates a service and a database, both labelled with the pull request', () => {
    deploy()

    expect(cloud.query({ pr: '1' }).map((resource) => resource.kind).sort()).toEqual([
      'database',
      'service',
    ])
  })

  it('labels the service with the commit it was built from', () => {
    deploy({ sha: 'bbb' })

    const service = cloud.query({ pr: '1' }).find((resource) => resource.kind === 'service')

    expect(service?.labels['sha']).toBe('bbb')
  })

  it('nests everything inside an owned namespace when the wiring asks for one', () => {
    deploy({ namespaced: true })

    const namespace = cloud.query({ pr: '1' }).find((resource) => resource.kind === 'namespace')

    expect(namespace).toBeDefined()
    for (const resource of cloud.query({ pr: '1' })) {
      if (resource.kind === 'namespace') continue
      expect(resource.parent).toBe(namespace?.id)
    }
  })

  it('records every id it created', () => {
    deploy({ namespaced: true })

    const record = deployer.record(1)

    expect(record?.ids).toHaveLength(3)
    for (const id of record?.ids ?? []) expect(cloud.has(id)).toBe(true)
  })
})

describe('a redeploy', () => {
  it('replaces the service and leaves the database standing', () => {
    deploy({ sha: 'aaa' })
    const database = cloud.query({ pr: '1' }).find((resource) => resource.kind === 'database')

    deploy({ sha: 'bbb' })

    const services = cloud.query({ pr: '1' }).filter((resource) => resource.kind === 'service')

    expect(services).toHaveLength(1)
    expect(services[0]?.labels['sha']).toBe('bbb')
    expect(cloud.has(database?.id ?? '')).toBe(true)
  })

  it('keeps the record pointing only at resources that still exist', () => {
    deploy({ sha: 'aaa' })

    deploy({ sha: 'bbb' })

    for (const id of deployer.record(1)?.ids ?? []) expect(cloud.has(id)).toBe(true)
  })

  it('reseeds the environment at the new commit schema', () => {
    deploy({ schema: BASE_SCHEMA })

    deploy({ schema: 'v2' })

    expect(seeds.schemaFor(1)).toBe('v2')
  })
})

describe('destroying', () => {
  it('deletes every recorded id and forgets the pull request', () => {
    deploy()

    deployer.destroy(1)

    expect(cloud.query({ pr: '1' })).toEqual([])
    expect(deployer.record(1)).toBeUndefined()
  })

  it('releases the environment dataset', () => {
    deploy({ schema: 'v2' })

    deployer.destroy(1)

    expect(seeds.schemaFor(1)).toBe(BASE_SCHEMA)
  })

  it('does nothing for a pull request it has no record of', () => {
    expect(() => {
      deployer.destroy(99)
    }).not.toThrow()
  })

  it('tolerates a recorded id whose resource a sweep already removed', () => {
    deploy()
    for (const resource of cloud.query({ pr: '1' })) cloud.delete(resource.id)

    expect(() => {
      deployer.destroy(1)
    }).not.toThrow()
  })
})

describe('a resource the deployer never created', () => {
  it('survives a teardown driven by the record when the stack is flat', () => {
    deploy({ namespaced: false })
    cloud.create({ kind: 'log-group', labels: { pr: '1' } })

    deployer.destroy(1)

    expect(cloud.query({ pr: '1' }).map((resource) => resource.kind)).toEqual(['log-group'])
  })

  it('goes with the namespace when the stack owns one', () => {
    deploy({ namespaced: true })
    const namespace = deployer.record(1)?.namespace ?? null
    cloud.create({ kind: 'log-group', parent: namespace, labels: { pr: '1' } })

    deployer.destroy(1)

    expect(cloud.query({ pr: '1' })).toEqual([])
  })

  it('is left behind with nothing referencing it, which is what `orphaned` means', () => {
    deploy({ namespaced: false })
    cloud.create({ kind: 'log-group', labels: { pr: '1' } })

    deployer.destroy(1)

    expect(deployer.record(1)).toBeUndefined()
    expect(cloud.query({ pr: '1' })).toHaveLength(1)
  })
})

describe('forgetting', () => {
  it('drops the record and leaves the cloud untouched, which is what a lost state file looks like', () => {
    deploy()

    deployer.forget(1)

    expect(deployer.record(1)).toBeUndefined()
    expect(cloud.query({ pr: '1' })).toHaveLength(2)
  })

  it('stops reporting the pull request as tracked', () => {
    deploy()

    deployer.forget(1)

    expect(deployer.tracked()).toEqual([])
  })
})
